// The import's inventory (src/lib/importer.ts gather and homeWords) and what stays on this computer (secrets.ts).
import { describe, expect, it } from 'vitest';
import { gather, homeWords, type ConfigItem, type LocalSource, type LocalUnit } from './importer';
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
