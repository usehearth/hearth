// What the guide's model may be shown from any page (src/lib/help.ts): planted client names, keys and addresses with
// secrets in them must not get through, wherever they sit in the data.
import { describe, expect, it } from 'vitest';
import { bareUrl, bareUrls, forModel, guardTools } from './help';
import { runTool, type ToolEnv } from './guide';

const KEYS = ['sk-ant-api03-PLANTEDkey0123456789abcdef', 'ghp_PLANTEDgithubToken0123456789', 'xoxb-PLANTED-slack-123456', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zQQ'];
const CLIENTS = ['Globex', 'Storm ID', 'EnjoyDigital'];

/** Every planted secret and client name that shows anywhere in what would be sent. */
function leaks(out: unknown): string[] {
  const text = JSON.stringify(out);
  const found = KEYS.filter((k) => text.includes(k));
  for (const c of ['Globex', 'globex', 'Storm ID', 'stormid', 'storm-id', 'EnjoyDigital', 'enjoy-digital', 'Enjoy Digital']) if (text.includes(c)) found.push(c);
  for (const s of ['hunter2', 'tok=PLANTED', 'planted-pass']) if (text.includes(s)) found.push(s);
  return found;
}

describe('forModel: what any page hands the guide', () => {
  it('hides client names in strings, nested lists and object keys, loosely (spacing, case, hyphens)', () => {
    const page = {
      title: 'Globex tickets', note: 'see stormid and enjoy-digital',
      rows: [{ name: 'storm-id-board', tags: ['Enjoy Digital', 'home'] }],
      byClient: { Globex: 3, 'Storm ID': 1 },
    };
    const out = forModel(page, CLIENTS);
    expect(leaks(out)).toEqual([]);
    expect(out.title).toBe('a client tickets');
    expect(out.rows[0].name).toBe('a client-board');
    expect(out.byClient).toEqual({ 'a client': 3, 'a client (2)': 1 });
  });
  it('replaces anything key-shaped, in values and keys', () => {
    const out = forModel({ token: KEYS[0], args: ['--pat', KEYS[1]], [KEYS[3]]: 'x', text: `Slack ${KEYS[2]} done` }, []);
    expect(leaks(out)).toEqual([]);
    expect(JSON.stringify(out)).toContain('‹key›');
  });
  it('strips what can carry a secret from web addresses: user and password, query and fragment', () => {
    expect(bareUrl('https://user:planted-pass@mcp.example.com/sse?tok=PLANTED#x')).toBe('https://mcp.example.com/sse');
    expect(bareUrls('Could not reach https://mcp.example.com/v1?api_key=hunter2 (timeout)')).toBe('Could not reach https://mcp.example.com/v1 (timeout)');
    expect(leaks(forModel({ url: 'https://a.example/mcp?tok=PLANTED&key=hunter2' }, []))).toEqual([]);
  });
  it('leaves numbers, flags and plain words alone', () => {
    expect(forModel({ n: 3, ok: true, none: null, words: 'Linear, Notion and a calendar' }, CLIENTS)).toEqual({ n: 3, ok: true, none: null, words: 'Linear, Notion and a calendar' });
  });
});

describe('guardTools: a page\'s tools as the model sees them', () => {
  const base: ToolEnv = { state: () => ({ v: 1, active: false, step: 'done', guide: null }), checkAddress: async () => null, checkDocker: async () => null, probe: async () => null, providers: async () => null, openLink: async () => {} };
  it('every answer passes the guard, with the client names known at the time of the call', async () => {
    let terms = ['Globex'];
    const planted = { phase: 'ready', homes: [{ title: 'Claude Code: Globex work', email: 'sam@globex.example', note: KEYS[0] }], url: 'https://x.example/?tok=PLANTED' };
    const env = { ...base, ...guardTools({ importSources: async () => planted, importReceipt: async () => null }, async () => terms) };
    const r = await runTool(env, { id: '1', name: 'import_sources', input: {} });
    expect(r.error).toBeFalsy();
    expect(leaks(r.content)).toEqual([]);
    expect(r.content).toContain('a client');
    terms = ['Initech'];
    const r2 = await runTool({ ...base, ...guardTools({ importSources: async () => ({ title: 'Initech' }) }, async () => terms) }, { id: '2', name: 'import_sources', input: {} });
    expect(r2.content).not.toContain('Initech');
    // No receipt yet: said plainly, not guessed.
    expect((await runTool(env, { id: '3', name: 'import_receipt', input: {} })).content).toContain('No import has finished');
  });
});
