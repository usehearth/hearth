import { describe, expect, it } from 'vitest';
import { connectorError, connectorState } from './connectors';

const cal = { name: 'calendar', title: 'Calendar', url: 'http://127.0.0.1:9/mcp', enabled: true, transport: 'http' as const };

describe('connector status in words', () => {
  it('says how many tools a working connector has', () => {
    expect(connectorState(cal, { ok: true, tools: ['a', 'b', 'c'], ms: 40 })).toEqual({ tone: 'ok', text: 'Connected · 3 tools' });
    expect(connectorState(cal, { ok: true, tools: ['a'] }).text).toBe('Connected · 1 tool');
  });
  it('turns "fetch failed" into what to check', () => {
    expect(connectorState(cal, { ok: false, error: 'fetch failed' })).toEqual({ tone: 'bad', text: "Couldn't reach Calendar at 127.0.0.1:9. Check the address, and that it's running." });
    expect(connectorError('connect ECONNREFUSED 127.0.0.1:9', cal).tone).toBe('bad');
  });
  it('asks for a sign-in when the server wants one', () => {
    expect(connectorState(cal, { ok: false, error: 'The server wants a sign-in (OAuth) or a token.' })).toEqual({ tone: 'signin', text: 'Calendar wants you to sign in, or a token.' });
    expect(connectorError('HTTP 401 Unauthorized', cal).tone).toBe('signin');
  });
  it('names timeouts, wrong addresses and bad certificates', () => {
    expect(connectorError('The operation was aborted due to timeout', cal).text).toBe("Calendar didn't answer in time. Try again in a moment.");
    expect(connectorError('Error POSTing to endpoint (HTTP 404): Not Found', cal).text).toBe('Nothing answered at http://127.0.0.1:9/mcp. Check the address (it often ends in /mcp).');
    expect(connectorError('self-signed certificate in certificate chain', cal).text).toBe("Calendar's certificate isn't trusted, so Hearth won't connect.");
    expect(connectorError('something odd', { name: 'docs' }).text).toBe("docs didn't work: something odd.");
  });
  it('off, command servers, not checked yet and checking', () => {
    expect(connectorState({ ...cal, enabled: false }, { ok: true }).tone).toBe('off');
    expect(connectorState({ name: 'devops', transport: 'stdio', enabled: true }).tone).toBe('idle');
    expect(connectorState(cal).text).toBe('Not checked yet.');
    expect(connectorState(cal, 'checking')).toEqual({ tone: 'checking', text: 'Checking…' });
  });
});
