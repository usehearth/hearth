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
import { HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, noteServer, noteUp, reconnectDelay, refusalOf, refusalText, waitAllowed, type CloseInfo } from './reach';

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
      /** While reconnecting: what is happening, when it is more than "Reconnecting…" (a long wait, a lockout). */
      note?: string;
      /** While reconnecting: try now instead of waiting. */
      tryNow?: () => void;
      /** Every open card this device may see (`_hearth/cards`); empty on servers without it. */
      cards: CardEntry[];
      /** The last refresh of the cards failed: these are the ones from before, and may be out of date. */
      cardsStale?: boolean;
      /** Older threads exist past the pages listed: loadMore lists more of them. */
      more?: boolean;
      loadMore?: () => void;
      answer: (e: CardEntry, a: CardAnswer) => Promise<unknown>;
      /** The `_hearth` extensions the server says it has (from initialize). */
      extensions: string[];
      /** H5: client lines for this device (empty on a work device, which lists client threads instead). */
      clients: ClientLine[];
      workDevice: boolean;
      /**
       * The server's client mode (`_hearth/device`). "simple": a client project is an ordinary project with a client
       * label. "strict": the server's strict client rules (work devices, the Clients section). Servers from before the
       * setting behave as strict.
       */
      clientMode: 'simple' | 'strict';
      /** An admin device (may make projects, change providers). */
      admin: boolean;
      /** Imported conversations whose folder isn't a project, by group. */
      importedGroups: ImportedGroup[];
      /** A request on the list connection (settings use it). */
      request: <T = unknown>(method: string, params?: unknown) => Promise<T> }
  | { state: 'error'; message: string; retry: () => void;
      /** The server refused this device's key: ask for a key (no more tries on our own, they count toward its lockout). */
      refused: boolean;
      /** Hearth keeps trying by itself (Retry tries now). */
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
  // should reconnect quietly (keep the list on screen) rather than show an error. When to try again, and when to stop
  // and ask for the key, comes from how the socket was refused (reach.ts), so an outage never becomes a lockout.
  const [attempt, setAttempt] = useState(0);
  const fails = useRef(0);
  const wasReady = useRef(false);
  // Pages of the thread list asked for (Load older threads adds MAX_PAGES), and the last Needs-you cards that loaded.
  const pagesWanted = useRef(MAX_PAGES);
  const lastCards = useRef<CardEntry[]>([]);
  useEffect(() => { wasReady.current = false; fails.current = 0; pagesWanted.current = MAX_PAGES; lastCards.current = []; }, [server?.id, server?.url, keyVersion, nonce]);

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
    const url = server.url;
    /** Try again after the backoff, or later if a lockout or the shared budget says so; returns the wait. */
    const reconnectLater = () => {
      const wait = Math.max(reconnectDelay(fails.current++), waitAllowed(url));
      if (live && !retry) retry = setTimeout(() => setAttempt((n) => n + 1), wait);
      return wait;
    };
    if (!wasReady.current) setSt({ state: 'connecting' });
    const app = new ClientApp({ name: 'hearth-directory' })
      .onNotification('_hearth/sessions_changed', (p: unknown) => p, () => {
        relist ??= setTimeout(() => { relist = null; refresh(); }, RELIST_MS);
      })
      .onNotification('_hearth/cards_changed', (p: unknown) => p, () => {
        relist ??= setTimeout(() => { relist = null; refresh(); }, RELIST_MS);
      });
    // How this socket ended (opened? which close code?), to tell a refused key and a lockout from an outage.
    const seen: CloseInfo = { opened: false };
    class Watched extends WebSocket {
      constructor(u: string | URL, protocols?: string | string[]) {
        super(u, protocols);
        this.addEventListener('open', () => { seen.opened = true; });
        this.addEventListener('close', (e) => { seen.code = e.code; seen.reason = e.reason; });
      }
    }
    const conn = app.connect(createWebSocketStream(url, { protocols: ['acp', `bearer.${key}`], WebSocket: Watched as never }));
    let hasCards = true;
    let cardsStale = false;
    const loadMore = () => { pagesWanted.current += MAX_PAGES; refresh(); };
    // Every page (servers that page send nextCursor), MAX_PAGES at a time so a huge server can't stall the sidebar;
    // "Load older threads" asks for more (pagesWanted), so nothing past them is out of reach.
    const listAll = async () => {
      const sessions: any[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < pagesWanted.current; n++) {
        const r: any = await conn.agent.request('session/list', cursor ? { cursor } : {});
        sessions.push(...(r?.sessions ?? []));
        cursor = typeof r?.nextCursor === 'string' ? r.nextCursor : undefined;
        if (!cursor) break;
      }
      return { sessions, more: !!cursor };
    };
    let hasClients = false;
    let hasHistory = false;
    let admin = false;
    let clientMode: 'simple' | 'strict' = 'strict';
    const list = async () => {
      const [res, cards] = await Promise.all([
        listAll(),
        hasCards ? (conn.agent.request('_hearth/cards' as any, {}) as Promise<any>).then((r) => {
          lastCards.current = (r?.cards ?? []) as CardEntry[];
          cardsStale = false;
          return lastCards.current;
        }, (e: any) => {
          if (e?.code === -32601) { hasCards = false; return [] as CardEntry[]; } // a plain ACP server: no cards
          // A refresh that failed (the server busy, a hiccup): keep what Needs you showed, and say it may be stale.
          cardsStale = true;
          return lastCards.current;
        }) : Promise.resolve([] as CardEntry[]),
      ]);
      const [cl, hc] = await Promise.all([
        hasClients ? (conn.agent.request('_hearth/clients' as any, {}) as Promise<any>).catch(() => null) : null,
        hasHistory ? (conn.agent.request('_hearth/history/counts' as any, {}) as Promise<any>).catch(() => null) : null,
      ]);
      return { groups: withHistory(group((res.sessions ?? []).map(toItem)), (hc?.projects ?? []) as HistoryCount[]), cards, cardsStale, more: res.more, loadMore, clients: (cl?.clients ?? []) as ClientLine[], workDevice: !!cl?.workDevice, admin, importedGroups: (hc?.groups ?? []) as ImportedGroup[] };
      return { groups: withHistory(group((res.sessions ?? []).map(toItem)), (hc?.projects ?? []) as HistoryCount[]), cards, clients: (cl?.clients ?? []) as ClientLine[], workDevice: !!cl?.workDevice, admin, clientMode, importedGroups: (hc?.groups ?? []) as ImportedGroup[] };
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
      setSt((prev) => (prev.state === 'ready' ? { ...prev, reconnecting: true, note: undefined, tryNow: undefined } : prev));
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
        if (ext.includes('new_project') || ext.includes('device')) {
          const dev = await (conn.agent.request('_hearth/device' as any, {}) as Promise<any>).catch(() => null);
          if (ext.includes('new_project')) admin = !!dev?.admin;
          clientMode = dev?.clientMode === 'simple' ? 'simple' : 'strict';
        }
        const first = await list();
        if (!live) return;
        const agent = String(init.agentInfo?.title ?? init.agentInfo?.name ?? 'ACP server');
        const extensions: string[] = Array.isArray(init?._meta?.hearth?.extensions) ? init._meta.hearth.extensions : [];
        const request = <T,>(method: string, params?: unknown) => conn.agent.request(method as any, (params ?? {}) as any) as Promise<T>;
        refresh = () => { void list().then((l) => live && setSt({ state: 'ready', agent, ...l, refresh, answer, extensions, request })).catch(() => { /* a drop reconnects */ }); };
        ready = true;
        wasReady.current = true;
        fails.current = 0;
        noteServer(url, init?._meta);
        noteUp(url);
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
        await new Promise((r) => setTimeout(r, 0)); // the close event may land just after the failure
        if (!live) return;
        const why = refusalOf(url, seen);
        if (why.kind === 'refused') {
          // The key: stop (every further try counts toward the server's lockout) and ask for one.
          wasReady.current = false;
          setSt({ state: 'error', message: refusalText(why, 0), retry: () => setNonce((n) => n + 1), refused: true, retrying: false });
          return;
        }
        // Away, locked out for a while, or unclear: try again when allowed, the list (if there was one) still shown.
        const wait = reconnectLater();
        const message = refusalText(why, wait);
        const long = why.kind === 'locked' || wait > 60_000;
        if (wasReady.current) setSt((prev) => (prev.state === 'ready' ? { ...prev, reconnecting: true, note: long ? message : undefined, tryNow: long ? tryNow : undefined } : prev));
        else setSt({ state: 'error', message, retry: tryNow, refused: false, retrying: true });
      }
    })();
    // Back to the window or back online: catch anything missed, or try again now rather than wait out the backoff
    // (never past a lockout or the shared budget: those protect the key).
    const now = () => { if (ready) refresh(); else if (retry && waitAllowed(url) === 0) tryNow(); };
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
