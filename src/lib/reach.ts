// Why a connection failed, and when to try again, without ever turning an outage into a lockout.
//
// The server allows 5 wrong device keys per address per 15 minutes, then refuses that address for a while. A browser
// can't see why a WebSocket was refused (a 401 or a 429 at the upgrade looks exactly like a server that is down), so:
// - A server that says why it refuses (it advertises `_meta.hearth.refusals: "close"` in initialize) opens the socket
//   and closes it with 4401 (key refused) or 4429 (address locked out; the reason says "retry in <seconds>"). Then a
//   socket that never opened means the server is away, and Hearth keeps trying for as long as it takes.
// - A server that doesn't say leaves it unclear: away, or turning the key away. Then every connection on the page
//   shares one budget of BUDGET failed tries per 15 minutes, below the server's lockout, and after that waits.

export interface CloseInfo { opened: boolean; code?: number; reason?: string }

export type Refusal =
  /** The server turned this device's key away (4401): ask for a key, try no more. */
  | { kind: 'refused' }
  /** Too many wrong keys from this address (4429): no tries before `until`. */
  | { kind: 'locked'; until: number }
  /** Never got through, on a server that says why it refuses: it is away. Keep trying. */
  | { kind: 'unreached' }
  /** Never got through, on a server that doesn't say: away, or the key. Try within the budget. */
  | { kind: 'unclear' };

/** How long a lockout lasts when the server doesn't say. */
export const LOCK_DEFAULT_MS = 15 * 60_000;
/** Failed tries allowed per server address in WINDOW_MS when the server doesn't say why it refuses (its lockout is 5). */
export const BUDGET = 4;
export const WINDOW_MS = 15 * 60_000;

const telling = new Set<string>();
const failures = new Map<string, number[]>();
const locks = new Map<string, number>();
const upListeners = new Map<string, Set<() => void>>();

/** After a good initialize: does this server say why it refuses? */
export function noteServer(url: string, initializeMeta: unknown): void {
  const refusals = (initializeMeta as { hearth?: { refusals?: unknown } } | undefined)?.hearth?.refusals;
  if (refusals === 'close') telling.add(url); else telling.delete(url);
}

export const tellsRefusals = (url: string) => telling.has(url);

/** Why an attempt to `url` failed, from how its socket closed. */
export function refusalOf(url: string, close: CloseInfo | undefined, now = Date.now()): Refusal {
  if (close?.code === 4401) return { kind: 'refused' };
  if (close?.code === 4429) {
    const seconds = /retry in (\d+)/.exec(close.reason ?? '')?.[1]; // core says "retry in 540" (seconds)
    const until = now + (seconds ? Number(seconds) * 1000 : LOCK_DEFAULT_MS) + 500; // a little after it lifts
    locks.set(url, Math.max(locks.get(url) ?? 0, until));
    return { kind: 'locked', until };
  }
  if (telling.has(url)) return { kind: 'unreached' };
  const recent = (failures.get(url) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  failures.set(url, recent);
  return { kind: 'unclear' };
}

/** Milliseconds before the next try to `url` is allowed by its lockout and the budget (0: now). */
export function waitAllowed(url: string, now = Date.now()): number {
  const lock = Math.max(0, (locks.get(url) ?? 0) - now);
  if (telling.has(url)) return lock;
  const recent = (failures.get(url) ?? []).filter((t) => now - t < WINDOW_MS);
  const budget = recent.length < BUDGET ? 0 : recent[0]! + WINDOW_MS - now;
  return Math.max(lock, budget);
}

/** A connection to `url` got through: forget its failures and wake the connections waiting on it. */
export function noteUp(url: string): void {
  failures.delete(url);
  locks.delete(url);
  for (const listener of [...(upListeners.get(url) ?? [])]) listener();
}

/** Called once any connection to `url` gets through again. */
export function onUp(url: string, listener: () => void): () => void {
  const set = upListeners.get(url) ?? new Set();
  set.add(listener);
  upListeners.set(url, set);
  return () => { set.delete(listener); };
}

/** Tests only. */
export function resetReach(): void { telling.clear(); failures.clear(); locks.clear(); upListeners.clear(); }

/** Waits before each reconnect attempt: quick at first, then every 30 s. */
export const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
export const reconnectDelay = (fails: number) => RECONNECT_MS[Math.min(fails, RECONNECT_MS.length - 1)]!;

/** "14:05", for "next try at". */
export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What to tell a person, by refusal (`wait`: ms until the next try). */
export function refusalText(r: Refusal, wait: number, now = Date.now()): string {
  switch (r.kind) {
    case 'refused': return "The server refused this device's key. It may have been revoked: paste a new one.";
    case 'locked': return `The server is refusing this address for a while, after too many wrong keys. Hearth tries again at ${clock(r.until)}.`;
    case 'unreached': return "Can't reach the server. Trying again…";
    case 'unclear': return wait > 60_000
      ? `Can't connect: the server may be down, or it may have turned this device's key away. Next try at ${clock(now + wait)}.`
      : "Can't connect. Trying again…";
  }
}

/** How often an idle connection proves it is still there, and how long it may take to answer. */
export const HEARTBEAT_MS = 25_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
