import { describe, expect, it } from 'vitest';
import { anthropic, findKeys, greeting, linkAllowed, openai, pickModel, runTool, runTurn, scrub, systemPrompt, type ChatItem, type ToolEnv } from './guide';
import { nextStep, providerVerdict, type SetupState } from './setup';
import { friendly } from './directory';

const state: SetupState = { v: 1, active: true, step: 'server', guide: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', models: [] }, where: 'other' };
const env = (over: Partial<ToolEnv> = {}): ToolEnv => ({
  state: () => state,
  checkAddress: async (url) => ({ tried: url, result: 'refused' }),
  checkDocker: async () => ({ installed: true, running: false }),
  probe: async () => ({ ok: false }),
  providers: async () => ({ providers: [] }),
  openLink: async () => {},
  ...over,
});

describe('key detection', () => {
  it('finds known key shapes and long mixed tokens', () => {
    expect(findKeys('my key is sk-ant-api03-abcDEF123456789_xyz ok')).toEqual(['sk-ant-api03-abcDEF123456789_xyz']);
    expect(findKeys('sk-proj-AbCdEfGh1234567890abcd')).toHaveLength(1);
    expect(findKeys('device key: Xk9fQ2mLp7RtZ4vB8nW1cJ6hD3sG5aYe here')).toEqual(['Xk9fQ2mLp7RtZ4vB8nW1cJ6hD3sG5aYe']);
  });
  it('leaves ordinary text, addresses and commands alone', () => {
    expect(findKeys('connect to ws://192.168.1.20:8470/acp then run docker compose logs core')).toEqual([]);
    expect(findKeys('git clone https://github.com/usehearth/hearth-server.git')).toEqual([]);
    expect(findKeys('commit 4b322a4f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b')).toEqual([]); // hex, lower case only
  });
  it('scrubs keys out of text', () => {
    expect(scrub('{"err":"bad key sk-ant-api03-abcDEF123456789_xyz"}')).toBe('{"err":"bad key ‹key›"}');
  });
});

describe('model choice', () => {
  it('prefers Haiku 5.5 for Claude', () => {
    expect(pickModel('anthropic', ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5'])).toBe('claude-haiku-5-5');
    expect(pickModel('anthropic', ['claude-opus-5-5', 'claude-haiku-4-5'])).toBe('claude-haiku-4-5');
  });
  it('picks a small chat model on OpenAI-style endpoints', () => {
    expect(pickModel('openai', ['text-embedding-3-small', 'gpt-big', 'gpt-mini'])).toBe('gpt-mini');
    expect(pickModel('openai', ['whisper-1', 'llama3.3:70b'])).toBe('llama3.3:70b');
  });
});

describe('provider formats', () => {
  it('Anthropic: parses tool calls and replays content unchanged', () => {
    const resp = { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 't1', name: 'check_docker', input: {} }] };
    const p = anthropic.parse(resp);
    expect(p).toMatchObject({ text: 'Let me check.', stop: 'tool', calls: [{ id: 't1', name: 'check_docker' }], usage: { input: 10, output: 5 } });
    expect(anthropic.assistant(resp)).toEqual({ role: 'assistant', content: resp.content });
    expect(anthropic.results([{ id: 't1', content: 'x' }, { id: 't2', content: 'y', error: true }])).toEqual([{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'x' }, { type: 'tool_result', tool_use_id: 't2', content: 'y', is_error: true }] }]);
    const body = anthropic.body('claude-haiku-5-5', 'sys', [], [{ name: 'a', description: 'b', schema: {} }]);
    expect(body).toMatchObject({ system: 'sys', output_config: { effort: 'low' }, tools: [{ name: 'a', input_schema: {} }] });
    expect(anthropic.body('claude-3-haiku', 's', [], [])).not.toHaveProperty('output_config');
  });
  it('OpenAI: parses function calls and tool messages', () => {
    const resp = { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'check_address', arguments: '{"url":"1.2.3.4:8470"}' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
    expect(openai.parse(resp)).toMatchObject({ stop: 'tool', calls: [{ id: 'c1', name: 'check_address', input: { url: '1.2.3.4:8470' } }], usage: { input: 3, output: 2 } });
    expect(openai.results([{ id: 'c1', content: 'ok' }])).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
    expect(openai.body('m', 'sys', [{ role: 'user', content: 'hi' }], [])).toEqual({ model: 'm', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] });
  });
});

describe('tools', () => {
  it('scrubs tool results and refuses links off the list', async () => {
    const out = await runTool(env({ checkAddress: async () => ({ detail: 'bearer sk-ant-api03-abcDEF123456789_xyz' }) }), { id: '1', name: 'check_address', input: { url: 'x:1' } });
    expect(out.content).toContain('‹key›');
    expect(out.content).not.toContain('sk-ant');
    expect(linkAllowed('https://console.anthropic.com/settings/keys')).toBe(true);
    expect(linkAllowed('http://console.anthropic.com/')).toBe(false);
    expect(linkAllowed('https://evil.example/')).toBe(false);
    expect((await runTool(env(), { id: '2', name: 'open_link', input: { url: 'https://evil.example/' } })).error).toBe(true);
  });
  it('turns a thrown error into an error result', async () => {
    const out = await runTool(env({ checkDocker: async () => { throw new Error('boom'); } }), { id: '1', name: 'check_docker', input: {} });
    expect(out).toEqual({ content: 'Failed: boom', error: true });
  });
});

describe('a turn', () => {
  it('runs tools, then answers, with replies and usage', async () => {
    const replies = [
      { stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'a', name: 'check_address', input: {} }, { type: 'tool_use', id: 'b', name: 'suggest_replies', input: { replies: ['Try again', 'Help'] } }] },
      { stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 20 }, content: [{ type: 'text', text: 'Nothing is listening there.' }] },
    ];
    const bodies: any[] = [];
    const items: ChatItem[] = [];
    const r = await runTurn({ guide: state.guide!, system: 'sys', history: [], text: 'is it up?', env: env({ state: () => ({ ...state, address: 'ws://h:8470/acp' }) }),
      call: async (b) => { bodies.push(b); return replies.shift(); }, onItem: (i) => items.push(i) });
    expect(items).toEqual([{ kind: 'tool', label: 'Checked the server address', error: undefined }, { kind: 'assistant', text: 'Nothing is listening there.' }]);
    expect(r.replies).toEqual(['Try again', 'Help']);
    expect(r.usage).toEqual({ input: 250, output: 30 });
    // Second call carries the tool results in one user message.
    expect(bodies[1].messages.at(-1).content.map((c: any) => c.tool_use_id)).toEqual(['a', 'b']);
    expect(r.history).toHaveLength(4);
  });
  it('stops after the round limit', async () => {
    const items: ChatItem[] = [];
    await runTurn({ guide: state.guide!, system: 's', history: [], text: 'x', env: env(), rounds: 2, onItem: (i) => items.push(i),
      call: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'check_docker', input: {} }] }) });
    expect(items.at(-1)).toMatchObject({ kind: 'error' });
  });
});

describe('setup state', () => {
  it('walks the steps in order', () => {
    expect(nextStep('key')).toBe('server');
    expect(nextStep('provider')).toBe('done');
    expect(nextStep('done')).toBe('done');
  });
  it('says whether the server has a working model', () => {
    expect(providerVerdict(null).ok).toBe(true);
    expect(providerVerdict([]).ok).toBe(false);
    expect(providerVerdict([{ name: 'a', kind: 'anthropic', enabled: true, status: 'down', last_error: 'key refused' }])).toMatchObject({ ok: false });
    expect(providerVerdict([{ name: 'a', kind: 'anthropic', enabled: true, status: 'ok', last_error: null }]).ok).toBe(true);
  });
  it('puts the current situation in the prompt and greets from it', () => {
    expect(systemPrompt({ ...state, address: 'ws://h:8470/acp', notes: { address: 'refused' } }, 'Windows')).toMatch(/runs Windows[\s\S]*Address: ws:\/\/h:8470\/acp[\s\S]*address: refused/);
    expect(greeting({ ...state, step: 'connect' }, true)).toMatch(/device key/);
  });
});

describe('connect errors', () => {
  it('never shows an empty error when the server refuses the key', () => {
    expect(friendly(new Error(''))).toMatch(/refused the key/);
    expect(friendly(undefined)).toMatch(/refused the key/);
    expect(friendly(new Error('No answer from the server.'))).toBe('No answer from the server.');
  });
});
