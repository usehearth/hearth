// Inside the VS Code extension (packages/vscode), the app talks to the extension: device keys live in VS Code's secret
// storage (asked for and saved through messages), and the editor can put text in the composer or open a thread.
// Elsewhere (web, desktop) none of this runs. Message spec: packages/vscode/README.md, "App bridge".
type Api = { postMessage: (m: unknown) => void };
declare global {
  interface Window { acquireVsCodeApi?: () => Api; __HEARTH_VSCODE__?: { assetBase?: string } }
}

let api: Api | null = null;
try { api = typeof window !== 'undefined' && window.acquireVsCodeApi ? window.acquireVsCodeApi() : null; } catch { api = null; }

export const inVsCode = !!api;

/** Where the app's own files are (the webview serves them from the extension, not from "/"). */
export const assetUrl = (file: string) => `${(typeof window !== 'undefined' && window.__HEARTH_VSCODE__?.assetBase) || ''}/${file.replace(/^\//, '')}`;

const waiting = new Map<string, ((key: string | null) => void)[]>();
type HostEvent = { type: 'hearth.insert'; text: string } | { type: 'hearth.openThread'; sessionId: string };
const listeners = new Set<(e: HostEvent) => void>();
const early: HostEvent[] = [];

if (api) {
  window.addEventListener('message', (ev: MessageEvent) => {
    const m = ev.data as { type?: string; serverId?: string; key?: string | null; text?: string; sessionId?: string };
    if (m?.type === 'hearth.key' && typeof m.serverId === 'string') {
      for (const r of waiting.get(m.serverId) ?? []) r(typeof m.key === 'string' ? m.key : null);
      waiting.delete(m.serverId);
    } else if (m?.type === 'hearth.insert' && typeof m.text === 'string') emit({ type: 'hearth.insert', text: m.text });
    else if (m?.type === 'hearth.openThread' && typeof m.sessionId === 'string') emit({ type: 'hearth.openThread', sessionId: m.sessionId });
  });
}
function emit(e: HostEvent) { if (listeners.size) for (const l of listeners) l(e); else early.push(e); }

/** Say the app is listening (the extension holds inserts until then). */
export function hostReady() { api?.postMessage({ type: 'hearth.ready' }); }

export function onHostEvent(f: (e: HostEvent) => void) {
  listeners.add(f);
  for (const e of early.splice(0)) f(e);
  return () => { listeners.delete(f); };
}

export function hostGetKey(serverId: string): Promise<string | null> {
  if (!api) return Promise.resolve(null);
  return new Promise((resolve) => {
    (waiting.get(serverId) ?? waiting.set(serverId, []).get(serverId)!).push(resolve);
    api!.postMessage({ type: 'hearth.getKey', serverId });
    setTimeout(() => resolve(null), 5000);
  });
}
export const hostSetKey = (serverId: string, key: string) => api?.postMessage({ type: 'hearth.setKey', serverId, key });
export const hostDeleteKey = (serverId: string) => api?.postMessage({ type: 'hearth.deleteKey', serverId });
