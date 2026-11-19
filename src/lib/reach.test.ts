import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthUrl, reconnectDelay, serverUp } from './reach';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('healthUrl', () => {
  it('maps the ACP socket address to /healthz beside it', () => {
    expect(healthUrl('ws://127.0.0.1:8471/acp')).toBe('http://127.0.0.1:8471/healthz');
    expect(healthUrl('wss://ai.home.example/acp')).toBe('https://ai.home.example/healthz');
    expect(healthUrl('wss://example.com/hearth/acp')).toBe('https://example.com/hearth/healthz');
  });
});

describe('serverUp', () => {
  it('is true only for a 2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    expect(await serverUp('ws://h/acp')).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 }))); // a proxy in front of a server that is down
    expect(await serverUp('ws://h/acp')).toBe(false);
  });

  it('is false when the server cannot be reached or the answer cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await serverUp('ws://h/acp')).toBe(false);
  });

  it('gives up on a server that does not answer in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    const up = serverUp('ws://h/acp', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await up).toBe(false);
  });
});

it('reconnects quickly at first, then every 30 s for as long as it takes', () => {
  expect([0, 1, 2, 3, 4, 5, 50].map(reconnectDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
});
