import { beforeEach, describe, expect, it } from 'vitest';
import { BUDGET, noteServer, noteUp, onUp, reconnectDelay, refusalOf, refusalText, resetReach, waitAllowed, WINDOW_MS } from './reach';

const URL = 'ws://h/acp';
beforeEach(() => resetReach());

describe('refusalOf', () => {
  it('reads a refused key and a lockout from the close code', () => {
    expect(refusalOf(URL, { opened: true, code: 4401, reason: 'key refused' })).toEqual({ kind: 'refused' });
    expect(refusalOf(URL, { opened: true, code: 4429, reason: 'retry in 600 s' }, 1000)).toEqual({ kind: 'locked', until: 601_500 });
  });

  it('a lockout with no time given lasts the default 15 minutes', () => {
    expect(refusalOf(URL, { opened: true, code: 4429 }, 0)).toEqual({ kind: 'locked', until: 15 * 60_000 + 500 });
  });

  it('a socket that never opened: the server is away, if it says why it refuses; otherwise it is unclear', () => {
    expect(refusalOf(URL, { opened: false, code: 1006 })).toEqual({ kind: 'unclear' });
    noteServer(URL, { hearth: { refusals: 'close' } });
    expect(refusalOf(URL, { opened: false, code: 1006 })).toEqual({ kind: 'unreached' });
    noteServer(URL, { hearth: {} });
    expect(refusalOf(URL, { opened: false })).toEqual({ kind: 'unclear' });
  });
});

describe('waitAllowed', () => {
  it('on a server that does not say, allows BUDGET failed tries per window, then waits for the oldest to age out', () => {
    for (let i = 0; i < BUDGET; i++) {
      expect(waitAllowed(URL, i)).toBe(0);
      refusalOf(URL, { opened: false }, i);
    }
    expect(waitAllowed(URL, BUDGET)).toBe(WINDOW_MS - BUDGET);
    expect(waitAllowed(URL, WINDOW_MS)).toBe(0); // the first failure aged out
  });

  it('waits out a lockout, even on a server that says why', () => {
    noteServer(URL, { hearth: { refusals: 'close' } });
    refusalOf(URL, { opened: true, code: 4429, reason: 'retry in 60 s' }, 0);
    expect(waitAllowed(URL, 10_000)).toBe(50_500);
    expect(waitAllowed(URL, 61_000)).toBe(0);
  });

  it('never limits an outage on a server that says why', () => {
    noteServer(URL, { hearth: { refusals: 'close' } });
    for (let i = 0; i < 20; i++) refusalOf(URL, { opened: false }, i);
    expect(waitAllowed(URL, 20)).toBe(0);
  });

  it('a connection getting through clears failures and lockouts, and wakes those waiting', () => {
    refusalOf(URL, { opened: true, code: 4429 }, 0);
    for (let i = 0; i < BUDGET; i++) refusalOf(URL, { opened: false }, i);
    let woken = 0;
    const off = onUp(URL, () => { woken++; });
    noteUp(URL);
    expect(waitAllowed(URL, 10)).toBe(0);
    expect(woken).toBe(1);
    off();
    noteUp(URL);
    expect(woken).toBe(1);
  });
});

it('says plainly what is happening', () => {
  expect(refusalText({ kind: 'refused' }, 0)).toMatch(/refused this device's key/);
  expect(refusalText({ kind: 'locked', until: 0 }, 0)).toMatch(/refusing this address for a while, after too many wrong keys\. Hearth tries again at/);
  expect(refusalText({ kind: 'unclear' }, 120_000)).toMatch(/may be down, or it may have turned this device's key away\. Next try at/);
  expect(refusalText({ kind: 'unreached' }, 1000)).toBe("Can't reach the server. Trying again…");
});

it('reconnects quickly at first, then every 30 s', () => {
  expect([0, 1, 2, 3, 4, 5, 50].map(reconnectDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
});
