// Why a connection failed. A browser can't see the HTTP status of a refused WebSocket: a server that is down and one
// that refused the device key look the same (close code 1006). So after a failure Hearth asks the server's /healthz,
// which core answers to any page: up means the socket itself was refused (the key, or the bad-key lockout); down, or
// no answer, means the server is away (restarting, offline), and Hearth keeps trying without spending the key's tries.

/** The /healthz address beside an ACP WebSocket address (ws://host/acp -> http://host/healthz; a path prefix is kept). */
export function healthUrl(wsUrl: string): string {
  const u = new URL(wsUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = u.pathname.replace(/\/acp\/?$/, '') + '/healthz';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** True when the server answers /healthz with a 2xx within `timeoutMs`. Any failure (offline, a proxy's 502, an older
 * server whose /healthz isn't readable cross-origin) is false: then the caller keeps retrying rather than blame the key. */
export async function serverUp(wsUrl: string, timeoutMs = 4000): Promise<boolean> {
  let url: string;
  try { url = healthUrl(wsUrl); } catch { return false; }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: abort.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Waits before each reconnect attempt: quick at first, then every 30 s for as long as the server is away. */
export const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
export const reconnectDelay = (fails: number) => RECONNECT_MS[Math.min(fails, RECONNECT_MS.length - 1)];

/**
 * Refusals while the server is up before Hearth stops and asks for the key again. Each refused try counts toward the
 * server's bad-key lockout (5 per 15 minutes), so stay well under it; a server that is away costs no tries.
 */
export const REFUSED_AFTER = 2;

/** How often an idle connection proves it is still there, and how long it may take to answer. */
export const HEARTBEAT_MS = 25_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
