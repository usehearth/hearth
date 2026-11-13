// The server's thread list: one light ACP connection per server that only lists (`session/list`).
// The server owns the chats; Hearth shows its list and keeps nothing. It stays live: the server says
// `_hearth/sessions_changed` when a chat is created or changes (title, running, needs you, pinned) and Hearth lists
// again. A dropped connection reconnects on its own; a server without the extension still works (refresh by hand).
import { useEffect, useRef, useState } from 'react';
import { ClientApp, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { keyFor, type Server } from './servers';
import type { CardAnswer, CardEntry } from './hearth';

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
  /** Set for a client project's thread (H5): the client's name. Only a work device is sent these. */
  client?: string;
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
  | { state: 'error'; message: string; retry: () => void };

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
    ...(typeof h.client === 'string' && h.client ? { client: h.client } : {}),
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
const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
/** Failed reconnects before the list gives way to the error (and the key prompt: the key may have been revoked). */
const GIVE_UP_AFTER = 2; // each refused try counts toward the server's bad-key lockout (5 per 15 min), so stay well under

/** Lists the server's threads and keeps the list live. Reconnects when the key changes or the socket drops. */
export function useDirectory(server: Server | undefined, keyVersion: number): DirectoryState {
  const [st, setSt] = useState<DirectoryState>({ state: 'connecting' });
  const [nonce, setNonce] = useState(0);
  // Each bump reconnects. `fails` picks the backoff and resets after a good connect; `wasReady` says a drop
  // should reconnect quietly (keep the list on screen) rather than show an error.
  const [attempt, setAttempt] = useState(0);
  const fails = useRef(0);
  const wasReady = useRef(false);
  useEffect(() => { wasReady.current = false; fails.current = 0; }, [server?.id, server?.url, keyVersion, nonce]);

  useEffect(() => {
    if (!server) return;
    const key = keyFor(server.id);
    if (!key) { setSt({ state: 'no-key' }); return; }
    let live = true;
    let ready = false;
    let relist: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let refresh = () => {};
    const reconnectLater = () => {
      if (!live || retry) return;
      const wait = RECONNECT_MS[Math.min(fails.current++, RECONNECT_MS.length - 1)];
      retry = setTimeout(() => setAttempt((n) => n + 1), wait);
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
    let hasClients = false;
    let hasHistory = false;
    let admin = false;
    const list = async () => {
      const [res, cards] = await Promise.all([
        conn.agent.request('session/list', {}) as Promise<any>,
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
      const r = await conn.agent.request('_hearth/card/answer' as any, { sessionId: e.sessionId, itemId: e.card.id, ...a });
      refresh();
      return r;
    };
    void conn.closed.finally(() => {
      if (!ready || !live) return;
      setSt((prev) => (prev.state === 'ready' ? { ...prev, reconnecting: true } : prev));
      reconnectLater();
    }).catch(() => {});
    (async () => {
      try {
        const init: any = await conn.agent.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'hearth', version: '0.1.0' },
        });
        if (!init?.agentCapabilities?.sessionCapabilities?.list) throw new Error('This server does not list its chats (no session/list).');
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
        setSt({ state: 'ready', agent, ...first, refresh, answer, extensions, request });
      } catch (e) {
        if (!live) return;
        if (wasReady.current && fails.current < GIVE_UP_AFTER) { reconnectLater(); return; } // keep the list, keep trying
        wasReady.current = false;
        setSt({ state: 'error', message: friendly(e), retry: () => setNonce((n) => n + 1) });
      }
    })();
    // Back to the window: catch anything missed while asleep.
    const onFocus = () => { if (ready) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      window.removeEventListener('focus', onFocus);
      if (relist) clearTimeout(relist);
      if (retry) clearTimeout(retry);
      try { conn.close(); } catch { /* */ }
    };
  }, [server?.id, server?.url, keyVersion, nonce, attempt]);
  return server ? st : { state: 'connecting' };
}

export function friendly(e: unknown): string {
  // A WebSocket error arrives as a bare Event (no message): the server is down or refused the key.
  const m = (e as Error)?.message ?? (typeof Event !== 'undefined' && e instanceof Event ? 'closed' : String(e));
  if (/closed|failed|1006|ECONNREFUSED/i.test(m)) return "Can't reach the server, or it refused the key.";
  return m;
}
