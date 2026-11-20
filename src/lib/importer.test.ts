// The import's inventory (src/lib/importer.ts gather and homeWords) and what stays on this computer (secrets.ts).
import { describe, expect, it } from 'vitest';
import { RunGone, applyPlaceDecisions, dateRange, gather, homeStats, homeWords, isRunGone, leftOutFrom, rememberOf, type ConfigItem, type LocalSource, type LocalUnit } from './importer';
import { clientMatcher, holdBack, secretHits } from './secrets';
import type { ChatExport } from './claudeai';

const H1 = 'C:/Users/sam/.claude/projects', H2 = 'C:/Users/sam/.claude-work/projects';
const home = (over: Partial<LocalSource> = {}): LocalSource => ({ path: H1, label: 'Claude Code (~/.claude)', kind: 'claude-code', conversations: 3, home: '~/.claude', homePath: 'C:/Users/sam/.claude', ...over });
const unit = (id: string, from: string, over: Partial<LocalUnit> = {}): LocalUnit => ({ id, folder: 'f', uuid: id, source: 'claude-code', fingerprint: 'x', cwd: 'C:/p', repo: 'C:/p', title: `Conv ${id}`, started: null, ended: null,
  messages: 2, threads: 0, bytes: 10, files: [{ rel: `f/${id}.jsonl`, size: 10 }], from, ...over });
const cfg = (key: string, source: string, name: string, content: string, over: Partial<ConfigItem> = {}): ConfigItem => ({ key, source, origin: 'user', repo: null, kind: 'skill', name, description: null, bytes: content.length, content, files: null, leftOut: [], problem: null, ...over });
const chatExport = (over: Partial<ChatExport> = {}): ChatExport => ({ account: 'abcdef0123', label: 'claude.ai, sam@example.com', email: 'sam@example.com', name: null, inputs: ['claude-export'],
  units: [{ ...unit('c1', 'x'), source: 'claude-ai', folder: 'claude-ai-abcdef0123', cwd: null, repo: null, title: 'Sourdough' }], bytes: new Map(), skipped: 1, memories: [{ path: '/profile.md', content: 'hi' }],
  notKept: [{ id: 'e1', kind: 'chat', title: 'Empty one', reason: 'empty', detail: 'it has no messages' }, { id: 'artifact:1', kind: 'other', title: 'An artifact', reason: 'unsupported', detail: 'not yet' }], ignored: ['sign-in history'], ...over });

describe('homes in the person\'s terms', () => {
  it('names the profiles that share a home, says both are included, and who is signed in', () => {
    const w = homeWords(home({ profiles: [{ name: 'Personal', sessions: 412 }, { name: 'Work', sessions: 30 }], terminal: 12, email: 'sam@example.com', org: 'Sam\'s org', folders: 40, skills: 7, plugins: 2 }));
    expect(w.title).toBe('Claude Code: Personal and Work');
    expect(w.who).toBe("Signed in as sam@example.com (Sam's org)");
    expect(w.profiles).toBe('Personal and Work all keep their Code sessions here: both are included, with 12 sessions from the terminal.');
    expect(w.holds).toBe('3 conversations from 40 folders · 7 skills · 2 plugins');
  });
  it('a ~/.claude-something home is named by its own name; one with only the terminal says so', () => {
    expect(homeWords(home({ account: 'work', terminal: 14 })).title).toBe('Claude Code: work');
    expect(homeWords(home({ account: 'work', terminal: 14 })).profiles).toBe('14 sessions from the terminal.');
    expect(homeWords(home({ profiles: [{ name: 'Main', sessions: 3 }] })).title).toBe('Claude Code: the main Claude app');
    // A separate setup holding a copy of a desktop profile's session doesn't claim to be that profile's home.
    expect(homeWords(home({ account: 'agency', terminal: 2, profiles: [{ name: 'Personal', sessions: 1 }] })).profiles).toBe('2 sessions from the terminal and 1 session from the Personal profile.');
  });
});

describe('the inventory', () => {
  const sources = [home({ profiles: [{ name: 'Personal', sessions: 1 }, { name: 'Work', sessions: 1 }] }), home({ path: H2, account: 'work', home: '~/.claude-work' })];
  const scan = { units: [unit('a', H1, { profile: 'Personal', also: [H2] }), unit('b', H1, { profile: 'Work' }), unit('e', H1, { empty: true }), unit('u', H1, { unreadable: 'locked' })], odd: [{ from: H2, rel: 'f/bad id!.jsonl', reason: 'odd name' }] };
  const config = [
    cfg(`${H1}/user/skill/tidy`, H1, 'tidy', 'Tidy up.'), cfg(`${H2}/user/skill/tidy`, H2, 'tidy', 'Tidy up.'),
    cfg(`${H1}/user/skill/keys`, H1, 'keys', 'Deploy with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'),
    cfg(`${H1}/user/command/acme`, H1, 'acme-digest', 'Write the Acme digest.', { kind: 'command' }),
    cfg(`${H1}/plugin:gone`, H1, 'gone', '', { kind: 'plugin', content: null, problem: 'not on this computer', origin: 'plugin:gone' }),
  ];
  const g = gather({ sources, scan, config, exports: [chatExport()], clientTerms: ['Acme'] });
  const items = g.inventory.items;
  const of = (source: string) => items.filter((i) => i.source === source);

  it('lists everything found, per source, with the reason for anything that can\'t go', () => {
    expect(g.inventory.sources.map((s) => s.label)).toEqual(['Claude Code: Personal and Work', 'Claude Code: work', 'claude.ai, sam@example.com']);
    expect(of(H1).map((i) => `${i.kind}:${i.title}:${i.reason ?? i.dupOf ?? 'send'}`)).toEqual([
      'conversation:Conv a:send', 'conversation:Conv b:send', 'conversation:Conv e:empty', 'conversation:Conv u:unreadable',
      'skill:tidy:send', 'skill:keys:secret', 'command:acme-digest:client', 'other:The plugin gone:unreadable']);
    expect(of(H2).map((i) => `${i.kind}:${i.reason ?? (i.dupOf ? `same as ${i.dupOf === H1 ? 'home 1' : i.dupOf}` : 'send')}`)).toEqual(['conversation:same as home 1', 'conversation:unsupported', 'skill:same as home 1']);
    expect(of('claude-ai:abcdef0123').map((i) => `${i.kind}:${i.reason ?? 'send'}`)).toEqual(['chat:send', 'chat:empty', 'other:unsupported', 'memory:send']);
    expect(items.find((i) => i.title === 'Conv a')?.profile).toBe('Personal');
    expect(items.find((i) => i.title === 'Conv e')?.profile).toBe('terminal');
  });

  it('sends only what can go: no empty or unreadable conversation, no secret, no client name, a duplicate once', () => {
    expect([...g.units.keys()].sort()).toEqual(['a', 'b', 'c1']);
    expect(g.config.map((c) => c.key)).toEqual([`${H1}/user/skill/tidy`]);
    expect(JSON.stringify(g.config)).not.toContain('sk-ant');
    expect(g.memories).toEqual([{ account: 'abcdef0123', files: [{ path: '/profile.md', content: 'hi', updated_at: null }] }]);
  });

  it('a source the person leaves out is still listed, as left out by them, and nothing of it is sent', () => {
    const out = gather({ sources, scan, config, exports: [chatExport()], clientTerms: [], leftOut: { sources: new Set(['claude-ai:abcdef0123', H2]) } });
    expect(out.inventory.items.filter((i) => i.source === 'claude-ai:abcdef0123' && ['chat', 'memory'].includes(i.kind)).map((i) => i.reason)).toEqual(['skipped', 'empty', 'skipped']);
    expect(out.memories).toEqual([]);
    expect([...out.units.keys()].sort()).toEqual(['a', 'b']);
    expect(out.inventory.items.filter((i) => i.source === H2 && i.kind === 'skill')[0].reason).toBe('skipped');
  });
});

describe('what stays on this computer', () => {
  it('finds secrets in words, and ignores placeholders', () => {
    expect(secretHits('token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123')).toContain('an API key');
    expect(secretHits('password = hunter2hunter2_9')).toEqual(['a password or token']);
    expect(secretHits('api_key: <your-key>')).toEqual([]);
    expect(secretHits('Set API_KEY in your .env')).toEqual([]);
  });
  it('holds back a client name, as a whole word, in the content, a file or the name', () => {
    const c = clientMatcher(['Acme', 'ab']);
    expect(holdBack('report', 'For ACME only.', null, c)?.reason).toBe('client');
    expect(holdBack('acme-report', 'Weekly.', null, c)?.reason).toBe('client');
    expect(holdBack('x', 'Fine.', { 'ref.md': 'Acme notes' }, c)?.reason).toBe('client');
    expect(holdBack('x', 'Acmeology is a word.', null, c)).toBeNull();
    expect(holdBack('x', 'anything', null, clientMatcher([]))).toBeNull();
  });
});

describe('a home at a glance', () => {
  const at = (cwd: string, started: string, ended = started): LocalUnit => unit(Math.random().toString(36).slice(2), H1, { cwd, repo: null, started, ended });
  it('says when, where most of it is, and the commonest projects (the test-run home on Zed\'s laptop)', () => {
    const units = [
      ...Array.from({ length: 6 }, (_, i) => at(`C:/Projects/Other/pm-hq/test-clients/acme-api/.worktrees/t${i}`, '2026-10-07T10:00:00Z')),
      ...Array.from({ length: 4 }, (_, i) => at(`C:/Projects/Other/pm-hq/test-playground/.worktrees/t${i}`, '2026-10-08T10:00:00Z')),
      at('C:/Projects/Other/pm-hq/sandbox', '2026-10-09T09:00:00Z', '2026-10-10T18:00:00Z'),
      at('C:/Users/sam/AppData/Local/Temp', '2026-10-09T12:00:00Z'),
    ];
    const s = homeStats(units);
    expect(s.count).toBe(12);
    expect(dateRange(s.from, s.to)).toBe('7 to 10 Oct 2026');
    expect(s.mostlyIn).toEqual({ name: 'pm-hq', path: 'C:/Projects/Other/pm-hq', n: 11 });
    expect(s.top).toEqual([{ name: 'acme-api', n: 6 }, { name: 'test-playground', n: 4 }, { name: 'sandbox', n: 1 }]);
  });
  it('dates across months and years read plainly; a spread-out home has no "mostly in"', () => {
    expect(dateRange('2026-10-03T00:00:00Z', '2026-11-19T00:00:00Z')).toBe('3 Oct to 19 Nov 2026');
    expect(dateRange('2025-02-12T00:00:00Z', '2026-11-19T00:00:00Z')).toBe('12 Feb 2025 to 19 Nov 2026');
    expect(dateRange('2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z')).toBe('10 Oct 2026');
    const spread = homeStats(['C:/Projects/a', 'C:/Projects/b', 'D:/Work/c', 'C:/Users/sam'].map((c) => at(c, '2026-10-01T00:00:00Z')));
    expect(spread.mostlyIn).toBeNull();
  });
});

describe('what was offered and not taken', () => {
  const sources = [home()];
  const config = [
    cfg(`${H1}/user/skill/tidy`, H1, 'tidy', 'Tidy up.'), cfg(`${H1}/user/command/tars`, H1, 'tars', 'Talk like TARS.', { kind: 'command' }),
    cfg(`${H1}/user/skill/mfa`, H1, 'umbraco-mfa-login-provider', 'Set password = Placeholder123 in the sample config.'),
    cfg(`${H1}/user/skill-elsewhere/skills/development/upgrade`, H1, 'upgrade', 'Upgrade a site.', { nested: 'skills/development/upgrade' }),
    cfg(`${H1}/user/skill-elsewhere/skills/synced/pdf`, H1, 'pdf', 'Claude\'s own.', { nested: 'skills/synced/pdf' }),
  ];
  const scan = { units: [unit('a', H1)] };
  it('skills one folder down are found and named, not brought unless ticked; a single item can be left out', () => {
    const g = gather({ sources, scan, config, exports: [], leftOut: { items: new Set([`${H1}/user/command/tars`]), since: { [`import:ext:${H1}/user/command/tars`]: '2026-11-15T10:00:00Z' } } });
    const why = (t: string) => g.inventory.items.find((i) => i.title === t);
    expect(why('upgrade')).toMatchObject({ reason: 'not_loadable', detail: "in skills/development/upgrade, where Claude Code doesn't load it" });
    expect(why('pdf')?.detail).toMatch(/Claude app's own skills/);
    expect(why('tars')).toMatchObject({ reason: 'skipped', detail: 'you chose to leave it out on 15 Nov, and it stays out until you change it' });
    expect(g.config.map((c) => c.name)).toEqual(['tidy']);
  });
  it('a held-back item shows its matching line here (masked), names only the line on the receipt, and can be brought anyway', () => {
    const g = gather({ sources, scan, config, exports: [] });
    const h = g.held.get(`${H1}/user/skill/mfa`)!;
    expect(h.lines).toEqual(['line 1: Set password = Pla•••••••••23 in the sample config.']);
    const item = g.inventory.items.find((i) => i.title === 'umbraco-mfa-login-provider')!;
    expect(item.reason).toBe('secret');
    expect(item.detail).toContain('(line 1)');
    expect(item.detail).not.toContain('Placeholder123');
    const anyway = gather({ sources, scan, config, exports: [], leftOut: { bring: new Set([`${H1}/user/skill/mfa`, `${H1}/user/skill-elsewhere/skills/development/upgrade`]) } });
    expect(anyway.config.map((c) => [c.name, !!c.overrule])).toEqual([['tidy', false], ['tars', false], ['umbraco-mfa-login-provider', true], ['upgrade', false]]);
  });
  it('earlier choices come back as this run\'s starting point, and what changed is remembered', () => {
    const d = { [`import:source:${H2}`]: { decision: 'leave-out' as const, at: '2026-11-18T19:30:00Z' }, 'import:place:c:/projects/other/ai-test': { decision: 'leave-out' as const, at: '2026-11-18T19:30:00Z' },
      [`import:ext:${H1}/user/skill/mfa`]: { decision: 'bring' as const, at: '2026-11-18T19:30:00Z' } };
    const lo = leftOutFrom(d);
    expect([...lo.sources]).toEqual([H2]);
    expect([...lo.bring]).toEqual([`${H1}/user/skill/mfa`]);
    expect(applyPlaceDecisions({ 'c:/projects/other/ai-test': { action: 'new', name: 'ai-test', slug: 'ai-test', client: null }, x: { action: 'existing', slug: 'x' } }, d))
      .toEqual({ 'c:/projects/other/ai-test': { action: 'skip' }, x: { action: 'existing', slug: 'x' } });
    // This time: H2 is back in, the ai-test folder still out, tars newly left out, the mfa skill still brought.
    const r = rememberOf({ decisions: d, leftOut: { sources: new Set(), items: new Set([`${H1}/user/command/tars`]), bring: new Set([`${H1}/user/skill/mfa`]) }, sourceIds: [H1, H2],
      choices: { 'c:/projects/other/ai-test': { action: 'skip' } }, configKeys: [`${H1}/user/command/tars`, `${H1}/user/skill/mfa`], groups: [] });
    expect(r).toEqual({ [`import:source:${H2}`]: null, [`import:ext:${H1}/user/command/tars`]: 'leave-out' });
  });
});

describe('nothing dropped for its name or its files', () => {
  it("a renamed skill says what it was called; a skill's left-out files are each named", () => {
    const g = gather({ sources: [home()], scan: null, config: [
      cfg(`${H1}/user/skill/skill-1a2b3c4d`, H1, 'skill-1a2b3c4d', 'Japanese.', { renamed: '日本語' }),
      cfg(`${H1}/user/skill/tidy`, H1, 'tidy', 'Tidy.', { leftOut: ['logo.png', 'big.csv'] }),
    ], exports: [] });
    expect(g.inventory.items.map((i) => `${i.kind}:${i.title}:${i.reason ?? 'send'}`)).toEqual([
      'skill:日本語 (kept as skill-1a2b3c4d):send', 'skill:tidy:send', 'other:logo.png (a file in the skill tidy):unsupported', 'other:big.csv (a file in the skill tidy):unsupported']);
  });
});

describe('copies in several homes', () => {
  it('leaving out the home that owns a copy keeps the copy in a home that is kept: sent once, owned there', () => {
    const H3 = 'C:/Users/sam/.claude-tests/projects';
    const sources = [home(), home({ path: H2, account: 'work' }), home({ path: H3, account: 'tests' })];
    const scan = { units: [unit('a', H3, { also: [H1, H2] }), unit('b', H3)] };
    const g = gather({ sources, scan, config: [], exports: [], leftOut: { sources: new Set([H3]) } });
    const a = g.inventory.items.filter((i) => i.id === 'a');
    expect(a.map((i) => `${i.source === H1 ? 'H1' : i.source === H2 ? 'H2' : 'H3'}:${i.reason ?? (i.dupOf ? 'same as H1' : 'send')}`)).toEqual(['H1:send', 'H3:skipped', 'H2:same as H1']);
    expect([...g.units.keys()]).toEqual(['a']);
    expect(g.inventory.items.find((i) => i.id === 'b')?.reason).toBe('skipped');
  });
});

describe('a run the server lost (it restarted mid-import)', () => {
  it('is recognised by the server\'s code, or its words from an older server', () => {
    expect(isRunGone({ data: { code: 'run_gone' }, message: 'x' })).toBe(true);
    expect(isRunGone({ message: 'that import is no longer running; start again' })).toBe(true);
    expect(isRunGone(new RunGone(3))).toBe(true);
    expect(isRunGone({ message: 'a chunk too big' })).toBe(false);
  });
});
