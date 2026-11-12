// The server's thread list: one light ACP connection per server that only lists (`session/list`).
// The server owns the chats; Hearth shows its list and keeps nothing. It stays live: the server says
// `_hearth/sessions_changed` when a chat is created or changes (title, running, needs you, pinned) and Hearth lists
// again. A dropped connection reconnects on its own; a server without the extension still works (refresh by hand).
import { useEffect, useRef, useState } from 'react';
import { ClientApp, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { keyFor, type Server } from './servers';

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
}

export interface ProjectGroup { project: string; name: string; cwd: string; main?: ThreadItem; threads: ThreadItem[] }

export type DirectoryState =
  | { state: 'no-key' }
  | { state: 'connecting' }
  | { state: 'ready'; agent: string; groups: ProjectGroup[]; refresh: () => void; reconnecting?: boolean }
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
  };
}

export function group(items: ThreadItem[]): ProjectGroup[] {
  const by = new Map<string, ProjectGroup>();
  for (const it of items) {
    const g = by.get(it.project) ?? { project: it.project, name: it.projectName, cwd: it.cwd, threads: [] };
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
      });
    const conn = app.connect(createWebSocketStream(server.url, { protocols: ['acp', `bearer.${key}`] }));
    const list = async () => {
      const res: any = await conn.agent.request('session/list', {});
      return group((res.sessions ?? []).map(toItem));
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
        const groups = await list();
        if (!live) return;
        const agent = String(init.agentInfo?.title ?? init.agentInfo?.name ?? 'ACP server');
        refresh = () => { void list().then((g) => live && setSt({ state: 'ready', agent, groups: g, refresh })).catch(() => { /* a drop reconnects */ }); };
        ready = true;
        wasReady.current = true;
        fails.current = 0;
        setSt({ state: 'ready', agent, groups, refresh });
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
