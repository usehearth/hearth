// The receipt in words (src/lib/receipt.ts): the top line, the sums, the saved file, and the guide's copy.
import { describe, expect, it } from 'vitest';
import { addsUp, forGuide, headline, oneLine, receiptCsv, receiptText, sinceLastLine, type Receipt } from './receipt';

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  v: 1, runId: 4, at: '2026-11-19T10:00:00Z', by: 'owner', fresh: 2, changed: 1, check: { ok: true, problems: [] },
  sinceLast: { runId: 3, at: '2026-11-18T09:00:00Z', new: 2, changed: 1 },
  totals: { found: 6, kept: 3, here: 1, notKept: 2 },
  sources: [
    { id: 'h', kind: 'claude-code', label: 'Claude Code: Personal and Work', detail: 'Personal and Work all keep their Code sessions here: both are included.', found: 4, kept: 2, here: 1, notKept: 1,
      byKind: { conversation: { found: 3, kept: 2, here: 1, notKept: 0 }, skill: { found: 1, kept: 0, here: 0, notKept: 1 } },
      byProfile: { Personal: { found: 2, kept: 1, here: 1, notKept: 0 }, Work: { found: 1, kept: 1, here: 0, notKept: 0 } },
      notKeptItems: [{ kind: 'skill', title: 'deploy-keys', reason: 'secret', detail: 'it looks like it holds an API key' }], notes: [] },
    { id: 'a', kind: 'claude-ai', label: 'claude.ai, sam@example.com', detail: null, found: 2, kept: 1, here: 0, notKept: 1,
      byKind: { chat: { found: 2, kept: 1, here: 0, notKept: 1 } }, notKeptItems: [{ kind: 'chat', title: 'Nothing here', reason: 'empty', detail: 'it has no messages' }], notes: [] },
  ],
  ...over,
});

describe('import receipt', () => {
  it('says in one line whether everything found was kept', () => {
    expect(headline(receipt())).toBe('2 of 6 were not kept: see why below.');
    expect(headline({ totals: { found: 1034, kept: 1000, here: 34, notKept: 0 } })).toBe('Everything found was kept (1,034 things).');
    expect(headline({ totals: { found: 3, kept: 0, here: 3, notKept: 0 } })).toBe('Everything found was already here (3 things).');
    expect(headline({ totals: { found: 1, kept: 0, here: 0, notKept: 1 } })).toBe('1 of 1 was not kept: see why below.');
    expect(headline({ totals: { found: 0, kept: 0, here: 0, notKept: 0 } })).toBe('Nothing was found to bring across.');
    expect(oneLine(receipt())).toBe('4 of 6 things are on your server; 2 were not kept, and the receipt in Settings, Import from Claude says why.');
  });

  it('checks that found = kept + already here + not kept, everywhere, and that every not-kept thing is named', () => {
    expect(addsUp(receipt())).toBe(true);
    const r = receipt();
    r.sources[0].kept = 1;
    expect(addsUp(r)).toBe(false);
    const named = receipt();
    named.sources[1].notKeptItems = [];
    expect(addsUp(named)).toBe(false);
    const total = receipt({ totals: { found: 7, kept: 3, here: 1, notKept: 3 } });
    expect(addsUp(total)).toBe(false);
  });

  it('says how many are new since the last import', () => {
    expect(sinceLastLine(receipt())).toBe('2 new since your last import on 18 Nov (1 changed).');
    expect(sinceLastLine(receipt({ sinceLast: { runId: 3, at: '2026-11-18T09:00:00Z', new: 0, changed: 0 } }))).toBe('Nothing new since your last import on 18 Nov.');
    expect(sinceLastLine(receipt({ sinceLast: null }))).toBeNull();
  });

  it('saves every source, count, profile and thing not kept, with its reason', () => {
    const t = receiptText(receipt(), 'Home');
    for (const s of ['Import 4 to Home', '2 of 6 were not kept', 'Claude Code: Personal and Work', 'From the Personal profile', 'deploy-keys (skill): Held back: looks like it holds a secret',
      'Nothing here (claude.ai chat): Empty, it has no messages', 'Every count adds up']) expect(t).toContain(s);
    const csv = receiptCsv(receipt()).trim().split('\n');
    expect(csv[0]).toBe('source,kind,title,outcome,reason,detail');
    expect(csv).toHaveLength(1 + 2 + 2);
    expect(csv.some((l) => l.includes('"deploy-keys"') && l.includes('"not kept"'))).toBe(true);
  });

  it("gives the guide counts and reasons, never a client's name or a Claude Code conversation's title", () => {
    const r = receipt();
    r.sources[0].notKeptItems = [{ kind: 'conversation', title: 'Globex checkout redesign', reason: 'failed', detail: 'locked', client: true }];
    r.sources[0].byKind.conversation = { found: 3, kept: 1, here: 1, notKept: 1 };
    r.sources[0].byKind.skill = { found: 1, kept: 1, here: 0, notKept: 0 };
    r.sources[1].notKeptItems.push({ kind: 'command', title: 'globex-report', reason: 'client', detail: 'it names a client' });
    const g = forGuide(r);
    const json = JSON.stringify(g);
    expect(json).not.toContain('Globex');
    expect(json).not.toContain('globex');
    expect(g.sources[0]).toMatchObject({ source: 'Claude Code: Personal and Work', found: 4, kept: 2, here: 1, notKept: 1 });
    expect(g.sources[0].byProfile?.Work).toEqual({ found: 1, kept: 1, here: 0, notKept: 0 });
    expect(g.sources[0].notKeptItems[0].what).toBe('a client Claude Code conversation');
    expect(g.sources[1].notKeptItems.map((i) => i.what)).toEqual(['Nothing here', 'a client slash command']);
  });
});
