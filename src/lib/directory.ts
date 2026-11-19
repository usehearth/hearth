// The server's thread list: one light ACP connection per server that only lists (`session/list`).
// The server owns the chats; Hearth shows its list and keeps nothing. It stays live: the server says
// `_hearth/sessions_changed` when a chat is created or changes (title, running, needs you, pinned) and Hearth lists
// again. A dropped connection reconnects on its own; a server without the extension still works (refresh by hand).
import { useEffect, useRef, useState } from 'react';
import { ClientApp, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { keyFor, type Server } from './servers';
import type { CardAnswer, CardEntry } from './hearth';
import { adminAnswerSig } from './admin';
import { HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, reconnectDelay, REFUSED_AFTER, serverUp } from './reach';

export interface ThreadItem {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: string | null;
  project: string;
  projectName: string;
  kind: 'main' | 'work' | string;
  status: string | null;
  runnerOnline: boolean | null;
  pinned: boolean;
  /** Open cards in this thread (questions, approvals, permission prompts). */
  openCards: number;
  /** Archived (server extension `threads`): out of the list until put back. */
  archived?: boolean;
  /** Set for a client project's thread (H5): the client's name. Only a work device is sent these. */
  client?: string;
  /** An admin thread (server extension `admin_threads`): runs as the owner; only the admin key can type in it. */
  admin?: boolean;
}

export interface ProjectGroup { project: string; name: string; cwd: string; main?: ThreadItem; threads: ThreadItem[]; client?: string;
  /** Conversations imported from Claude into this project (`_hearth/history/counts`). */
  imported?: number }

/** Imported conversations from a folder that isn't a project (`_hearth/history/counts` groups). */
export interface ImportedGroup { group: string; count: number; client: boolean }

/** `_hearth/history/counts`: per project. */
interface HistoryCount { project: string; name: string; cwd: string; count: number; client?: string }

/** Adds the imported counts, and a group for a project that has only imported conversations. */
export function withHistory(groups: ProjectGroup[], counts: HistoryCount[]): ProjectGroup[] {
  if (!counts.length) return groups;
  const by = new Map(counts.map((c) => [c.project, c]));
  const out = groups.map((g) => (by.has(g.project) ? { ...g, imported: by.get(g.project)!.count } : g));
  for (const c of counts) if (!groups.some((g) => g.project === c.project)) out.push({ project: c.project, name: c.name, cwd: c.cwd, threads: [], imported: c.count, ...(c.client ? { client: c.client } : {}) });
  return out;
}

/** H5: one content-free line per client, for a device that may not open client threads. */
export interface ClientLine { client: string; needsYou: number }

export type DirectoryState =
  | { state: 'no-key' }
  | { state: 'connecting' }
  | { state: 'ready'; agent: string; groups: ProjectGroup[]; refresh: () => void; reconnecting?: boolean;
      /** Every open card this device may see (`_hearth/cards`); empty on servers without it. */
      cards: CardEntry[];
      answer: (e: CardEntry, a: CardAnswer) => Promise<unknown>;
      /** The `_hearth` extensions the server says it has (from initialize). */
      extensions: string[];
      /** H5: client lines for this device (empty on a work device, which lists client threads instead). */
      clients: ClientLine[];
      workDevice: boolean;
      /** An admin device (may make projects, change providers). */
      admin: boolean;
      /** Imported conversations whose folder isn't a project, by group. */
      importedGroups: ImportedGroup[];
      /** A request on the list connection (settings use it). */
      request: <T = unknown>(method: string, params?: unknown) => Promise<T> }
  | { state: 'error'; message: string; retry: () => void;
      /** The server is up and refused this device's key: ask for a key (no more tries on our own, they count toward its lockout). */
      refused: boolean;
      /** The server is away: Hearth keeps trying by itself (Retry tries now). */
      retrying: boolean };

const folderName = (cwd: string) => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;

export function toItem(s: any): ThreadItem {
  const h = s?._meta?.hearth ?? {};
  return {
    sessionId: String(s.sessionId),
    title: String(s.title ?? 'Untitled'),
    cwd: String(s.cwd ?? ''),
    updatedAt: s.updatedAt ?? null,
    project: String(h.project ?? s.cwd ?? ''),
    projectName: String(h.projectName ?? h.project ?? folderName(String(s.cwd ?? ''))),
    kind: h.kind ?? 'work',
    status: h.status ?? null,
    runnerOnline: h.runnerOnline ?? null,
    pinned: !!h.pinned,
    openCards: Number(h.openCards ?? 0) || 0,
    ...(h.archived ? { archived: true } : {}),
    ...(typeof h.client === 'string' && h.client ? { client: h.client } : {}),
    ...(h.admin ? { admin: true } : {}),
  };
}

export function group(items: ThreadItem[]): ProjectGroup[] {
  const by = new Map<string, ProjectGroup>();
  for (const it of items) {
    const g = by.get(it.project) ?? { project: it.project, name: it.projectName, cwd: it.cwd, threads: [], ...(it.client ? { client: it.client } : {}) };
    if (it.kind === 'main' && !g.main) g.main = it; else g.threads.push(it);
    by.set(it.project, g);
  }
  const latest = (g: ProjectGroup) => Math.max(...[g.main, ...g.threads].filter(Boolean).map((t) => Date.parse(t!.updatedAt ?? '') || 0));
  return [...by.values()].sort((a, b) => latest(b) - latest(a));
}

const RELIST_MS = 200;
const MAX_PAGES = 5;

/** Lists the server's threads and keeps the list live. Reconnects when the key changes or the socket drops. */
export function useDirectory(server: Server | undefined, keyVersion: number): DirectoryState {
  const [st, setSt] = useState<DirectoryState>({ state: 'connecting' });
  const [nonce, setNonce] = useState(0);
  // Each bump reconnects. `fails` picks the backoff and resets after a good connect; `wasReady` says a drop
  // should reconnect quietly (keep the list on screen) rather than show an error. `refusals` counts tries the server
  // refused while it was up (reach.ts): only those lead to asking for the key again; a server that is away costs none.
  const [attempt, setAttempt] = useState(0);
  const fails = useRef(0);
  const refusals = useRef(0);
  const wasReady = useRef(false);
  useEffect(() => { wasReady.current = false; fails.current = 0; refusals.current = 0; }, [server?.id, server?.url, keyVersion, nonce]);

  useEffect(() => {
    if (!server) return;
    const key = keyFor(server.id);
    if (!key) { setSt({ state: 'no-key' }); return; }
    let live = true;
    let ready = false;
    let relist: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let refresh = () => {};
    let beat: ReturnType<typeof setInterval> | null = null;
    const reconnectLater = () => {
      if (!live || retry) return;
      retry = setTimeout(() => setAttempt((n) => n + 1), reconnectDelay(fails.current++));
    };
    if (!wasReady.current) setSt({ state: 'connecting' });
    const app = new ClientApp({ name: 'hearth-directory' })
      .onNotification('_hearth/sessions_changed', (p: unknown) => p, () => {
        relist ??= setTimeout(() => { relist = null; refresh(); }, RELIST_MS);
      })
      .onNotification('_hearth/cards_changed', (p: unknown) => p, () => {
        relist ??= setTimeout(() => { relist = null; refresh(); }, RELIST_MS);
      });
    const conn = app.connect(createWebSocketStream(server.url, { protocols: ['acp', `bearer.${key}`] }));
    let hasCards = true;
    // Every page (servers that page send nextCursor), up to MAX_PAGES so a huge server can't stall the sidebar.
    const listAll = async () => {
      const sessions: any[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < MAX_PAGES; n++) {
        const r: any = await conn.agent.request('session/list', cursor ? { cursor } : {});
        sessions.push(...(r?.sessions ?? []));
        cursor = typeof r?.nextCursor === 'string' ? r.nextCursor : undefined;
        if (!cursor) break;
      }
      return { sessions };
    };
    let hasClients = false;
    let hasHistory = false;
    let admin = false;
    const list = async () => {
      const [res, cards] = await Promise.all([
        listAll(),
        hasCards ? (conn.agent.request('_hearth/cards' as any, {}) as Promise<any>).then((r) => (r?.cards ?? []) as CardEntry[], (e: any) => {
          if (e?.code === -32601) hasCards = false; // a plain ACP server: no cards
          return [] as CardEntry[];
        }) : Promise.resolve([] as CardEntry[]),
      ]);
      const [cl, hc] = await Promise.all([
        hasClients ? (conn.agent.request('_hearth/clients' as any, {}) as Promise<any>).catch(() => null) : null,
        hasHistory ? (conn.agent.request('_hearth/history/counts' as any, {}) as Promise<any>).catch(() => null) : null,
      ]);
      return { groups: withHistory(group((res.sessions ?? []).map(toItem)), (hc?.projects ?? []) as HistoryCount[]), cards, clients: (cl?.clients ?? []) as ClientLine[], workDevice: !!cl?.workDevice, admin, importedGroups: (hc?.groups ?? []) as ImportedGroup[] };
    };
    const answer = async (e: CardEntry, a: CardAnswer) => {
      // An admin card counts only with this install's signature (the runner checks it).
      const adminSig = e.card.admin?.requestId && a.optionId ? await adminAnswerSig(e.sessionId, e.card.admin.requestId, a.optionId) : undefined;
      const r = await conn.agent.request('_hearth/card/answer' as any, { sessionId: e.sessionId, itemId: e.card.id, ...a, ...(adminSig ? { adminSig } : {}) });
      refresh();
      return r;
    };
    /** The connection is gone (closed, or silent past the heartbeat): keep the list on screen and reconnect. */
    const lost = () => {
      if (!ready || !live) return;
      ready = false;
      setSt((prev) => (prev.state === 'ready' ? { ...prev, reconnecting: true } : prev));
      try { conn.close(); } catch { /* */ }
      reconnectLater();
    };
    void conn.closed.finally(lost).catch(() => {});
    const tryNow = () => { if (retry) { clearTimeout(retry); retry = null; } setAttempt((n) => n + 1); };
    (async () => {
      try {
        const init: any = await conn.agent.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'hearth', version: '0.1.0' },
        });
        if (!init?.agentCapabilities?.sessionCapabilities?.list) throw Object.assign(new Error('This server does not list its chats (no session/list).'), { final: true });
        const ext: string[] = Array.isArray(init?._meta?.hearth?.extensions) ? init._meta.hearth.extensions : [];
        hasClients = ext.includes('clients');
        hasHistory = ext.includes('history');
        if (ext.includes('new_project')) admin = !!(await (conn.agent.request('_hearth/device' as any, {}) as Promise<any>).catch(() => null))?.admin;
        const first = await list();
        if (!live) return;
        const agent = String(init.agentInfo?.title ?? init.agentInfo?.name ?? 'ACP server');
        const extensions: string[] = Array.isArray(init?._meta?.hearth?.extensions) ? init._meta.hearth.extensions : [];
        const request = <T,>(method: string, params?: unknown) => conn.agent.request(method as any, (params ?? {}) as any) as Promise<T>;
        refresh = () => { void list().then((l) => live && setSt({ state: 'ready', agent, ...l, refresh, answer, extensions, request })).catch(() => { /* a drop reconnects */ }); };
        ready = true;
        wasReady.current = true;
        fails.current = 0;
        refusals.current = 0;
        setSt({ state: 'ready', agent, ...first, refresh, answer, extensions, request });
        // Heartbeat: a socket can stay open and say nothing (a half-open connection after sleep or a network change);
        // the browser won't notice. Any answer to a ping proves it is alive, "method not found" included.
        beat = setInterval(() => {
          if (!ready || !live) return;
          let answered = false;
          const deadline = setTimeout(() => { if (!answered) lost(); }, HEARTBEAT_TIMEOUT_MS);
          void (conn.agent.request('_hearth/ping' as any, {}) as Promise<unknown>).catch(() => {}).finally(() => { answered = true; clearTimeout(deadline); });
        }, HEARTBEAT_MS);
      } catch (e) {
        if (!live) return;
        if ((e as { final?: boolean })?.final) {
          wasReady.current = false;
          setSt({ state: 'error', message: (e as Error).message, retry: () => setNonce((n) => n + 1), refused: false, retrying: false });
          return;
        }
        // Away (restarting, offline) or turned away? Only a refusal while the server is up counts toward asking for the
        // key again; while it is away Hearth keeps trying by itself, the list (if it had one) still on screen.
        const up = await serverUp(server.url);
        if (!live) return;
        refusals.current = up ? refusals.current + 1 : 0;
        if (!up || refusals.current < (wasReady.current ? REFUSED_AFTER : 1)) {
          reconnectLater();
          if (!wasReady.current) setSt({ state: 'error', message: up ? 'The server turned this device away. Trying again…' : "Can't reach the server. Trying again…", retry: tryNow, refused: false, retrying: true });
          return;
        }
        wasReady.current = false;
        setSt({ state: 'error', message: "The server refused this device's key. It may have been revoked: paste a new one.", retry: () => setNonce((n) => n + 1), refused: true, retrying: false });
      }
    })();
    // Back to the window or back online: catch anything missed, or try again now rather than wait out the backoff.
    const now = () => { if (ready) refresh(); else if (retry) tryNow(); };
    window.addEventListener('focus', now);
    window.addEventListener('online', now);
    return () => {
      live = false;
      window.removeEventListener('focus', now);
      window.removeEventListener('online', now);
      if (relist) clearTimeout(relist);
      if (retry) clearTimeout(retry);
      if (beat) clearInterval(beat);
      try { conn.close(); } catch { /* */ }
    };
  }, [server?.id, server?.url, keyVersion, nonce, attempt]);
  return server ? st : { state: 'connecting' };
}

export function friendly(e: unknown): string {
  // A WebSocket error arrives as a bare Event (no message), or as an error with an empty message: the server is down
  // or refused the key.
  const bare = e == null || e instanceof Error || (typeof Event !== 'undefined' && e instanceof Event);
  const m = (e as Error)?.message || (bare ? 'closed' : String(e));
  if (/closed|failed|1006|ECONNREFUSED/i.test(m)) return "Can't reach the server, or it refused the key.";
  return m;
}
