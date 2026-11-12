// The server's thread list: one light ACP connection per server that only lists (`session/list`).
// The server owns the chats; Hearth shows its list and keeps nothing.
import { useEffect, useState } from 'react';
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
}

export interface ProjectGroup { project: string; name: string; cwd: string; main?: ThreadItem; threads: ThreadItem[] }

export type DirectoryState =
  | { state: 'no-key' }
  | { state: 'connecting' }
  | { state: 'ready'; agent: string; groups: ProjectGroup[]; refresh: () => void }
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

/** Lists the server's threads. Reconnects when the key changes; `refresh` lists again. */
export function useDirectory(server: Server | undefined, keyVersion: number): DirectoryState {
  const [st, setSt] = useState<DirectoryState>({ state: 'connecting' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!server) return;
    const key = keyFor(server.id);
    if (!key) { setSt({ state: 'no-key' }); return; }
    let live = true;
    setSt({ state: 'connecting' });
    const app = new ClientApp({ name: 'hearth-directory' });
    const conn = app.connect(createWebSocketStream(server.url, { protocols: ['acp', `bearer.${key}`] }));
    const list = async () => {
      const res: any = await conn.agent.request('session/list', {});
      return group((res.sessions ?? []).map(toItem));
    };
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
        const refresh = () => { void list().then((g) => live && setSt({ state: 'ready', agent, groups: g, refresh })).catch(() => setNonce((n) => n + 1)); };
        setSt({ state: 'ready', agent, groups, refresh });
      } catch (e) {
        if (live) setSt({ state: 'error', message: friendly(e), retry: () => setNonce((n) => n + 1) });
      }
    })();
    return () => { live = false; try { conn.close(); } catch { /* */ } };
  }, [server?.id, server?.url, keyVersion, nonce]);
  return server ? st : { state: 'connecting' };
}

export function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/closed|failed|1006|ECONNREFUSED/i.test(m)) return "Can't reach the server, or it refused the key.";
  return m;
}
