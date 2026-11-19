// How a connector (an MCP server in Settings > Connectors) is doing, in words: from the server's test of it
// (`_hearth/mcp/test`), turned into a state a row can show with a dot and one line.

export type ConnectorTone = 'ok' | 'signin' | 'bad' | 'off' | 'idle' | 'checking';
export interface ConnectorState { tone: ConnectorTone; text: string }
export interface ConnectorInfo { name: string; title?: string | null; url?: string | null; enabled?: boolean; transport?: 'http' | 'stdio' }
export interface TestResult { ok: boolean; tools?: string[]; error?: string; ms?: number }

const labelOf = (s: ConnectorInfo) => s.title?.trim() || s.name;
const hostOf = (url?: string | null) => { try { return new URL(url ?? '').host; } catch { return url ?? 'its address'; } };

/** A failed test's message, in words that say what to do. */
export function connectorError(message: string, s: ConnectorInfo): ConnectorState {
  const m = message || '';
  const label = labelOf(s);
  if (/sign-in|oauth|\b401\b|unauthori[sz]ed|\b403\b|forbidden|token/i.test(m)) return { tone: 'signin', text: `${label} wants you to sign in, or a token.` };
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNRESET|socket hang up|network/i.test(m)) return { tone: 'bad', text: `Couldn't reach ${label} at ${hostOf(s.url)}. Check the address, and that it's running.` };
  if (/timed? ?out|ETIMEDOUT|aborted|abort/i.test(m)) return { tone: 'bad', text: `${label} didn't answer in time. Try again in a moment.` };
  if (/\b404\b|not found/i.test(m)) return { tone: 'bad', text: `Nothing answered at ${s.url ?? 'that address'}. Check the address (it often ends in /mcp).` };
  if (/certificate|self[- ]signed|\bSSL\b|\bTLS\b/i.test(m)) return { tone: 'bad', text: `${label}'s certificate isn't trusted, so Hearth won't connect.` };
  return { tone: 'bad', text: `${label} didn't work: ${m.replace(/\s+/g, ' ').trim().slice(0, 200) || 'no reason given'}.` };
}

/** A row's state: off, a command server (it can only start on the runner), being checked, or what the last test said. */
export function connectorState(s: ConnectorInfo, test?: TestResult | 'checking' | null): ConnectorState {
  if (s.enabled === false) return { tone: 'off', text: 'Off. Projects that use it don\'t get it until you turn it on.' };
  if (s.transport === 'stdio') return { tone: 'idle', text: 'Starts on the runner when a thread in a project that uses it begins.' };
  if (test === 'checking') return { tone: 'checking', text: 'Checking…' };
  if (!test) return { tone: 'idle', text: 'Not checked yet.' };
  if (test.ok) {
    const n = test.tools?.length ?? 0;
    return { tone: 'ok', text: `Connected · ${n} tool${n === 1 ? '' : 's'}` };
  }
  return connectorError(test.error ?? '', s);
}
