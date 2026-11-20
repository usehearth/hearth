// AcpClient (and the thread controller on top of it) against an in-memory socket, through the `webSocketFactory` hook.
// Known gaps are `it.fails` with the reason: they pass while the gap is there, and fail (so CI turns red) once fixed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpClient, type AcpClientOptions, type AcpWebSocketLike } from './AcpClient';
import { AcpThreadController } from './AcpThreadController';

type Frame = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: any; error?: any };

class FakeSocket implements AcpWebSocketLike {
  sent: Frame[] = [];
  closed = false;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  receive(frame: Omit<Frame, 'jsonrpc'>) { this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', ...frame }) }); }
  /** The last request of `method` the client sent. */
  request(method: string) { return [...this.sent].reverse().find((f) => f.method === method && f.id !== undefined); }
  reply(method: string, result: unknown) {
    const r = this.request(method);
    if (!r) throw new Error(`the client sent no ${method} (sent: ${this.methods().join(', ')})`);
    this.receive({ id: r.id, result });
  }
  replyError(method: string, message: string, code = -32603) { this.receive({ id: this.request(method)!.id, error: { code, message } }); }
  update(sessionId: string, update: Record<string, unknown>) { this.receive({ method: 'session/update', params: { sessionId, update } }); }
  drop() { this.onclose?.({ code: 1006 }); }
  methods() { return this.sent.map((f) => f.method ?? `reply ${String(f.id)}`); }
}

const INIT = { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: true } }, agentInfo: { name: 'fake', version: '0' } };
const MODES = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Ask' }, { id: 'plan', name: 'Plan' }] };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(options: Partial<AcpClientOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const client = new AcpClient({ url: 'ws://fake/acp', cwd: '/w', webSocketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; }, ...options });
  return { client, sockets, get ws() { return sockets.at(-1)!; } };
}
type Rig = ReturnType<typeof setup>;

async function connect(t: Rig, init: unknown = INIT) {
  const p = t.client.connect();
  t.ws.onopen!();
  await flush();
  t.ws.reply('initialize', init);
  return p;
}
async function openSession(t: Rig, id = 's1') {
  await connect(t);
  const p = t.client.ensureSession();
  await flush();
  t.ws.reply('session/new', { sessionId: id, modes: MODES });
  return p;
}
const permissionRequest = (id: number, sessionId = 's1') => ({
  id, method: 'session/request_permission',
  params: { sessionId, toolCall: { toolCallId: 'tool-1', title: 'npm test' }, options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }, { optionId: 'no', name: 'No', kind: 'reject_once' }] },
});

afterEach(() => { vi.useRealTimers(); });

describe('connecting', () => {
  it('shakes hands with initialize and reports each state', async () => {
    const t = setup({ clientInfo: { name: 'hearth', version: '0.1.0' } });
    const states: string[] = [];
    t.client.subscribeConnectionChange((s) => states.push(s));
    const result = await connect(t);
    expect(result.agentInfo?.name).toBe('fake');
    expect(t.ws.request('initialize')!.params).toMatchObject({ protocolVersion: 1, clientInfo: { name: 'hearth' } });
    expect(states).toEqual(['connecting', 'connected']);
    expect(t.client.connectionState).toBe('connected');
  });

  it('refuses a server that speaks another protocol version', async () => {
    const t = setup();
    await expect(connect(t, { ...INIT, protocolVersion: 2 })).rejects.toThrow(/protocol version 2/);
    expect(t.client.connectionState).toBe('disconnected');
    expect(t.ws.closed).toBe(true);
  });

  it('a socket that fails before the handshake rejects with the address', async () => {
    const t = setup();
    const p = t.client.connect();
    t.ws.onerror!();
    await expect(p).rejects.toThrow('ACP WebSocket connection to ws://fake/acp failed');
  });

  it('lifecycle requests have a deadline', async () => {
    const t = setup({ requestTimeoutMs: 20 });
    await connect(t);
    await expect(t.client.ensureSession()).rejects.toThrow('ACP session/new timed out after 20ms');
  });
});

describe('opening a thread', () => {
  it('a new thread sends session/new with its _meta', async () => {
    const t = setup({ newSessionMeta: { hearth: { project: 'todo-api' } } });
    expect(await openSession(t, 'new-1')).toBe('new-1');
    expect(t.ws.request('session/new')!.params).toEqual({ cwd: '/w', mcpServers: [], _meta: { hearth: { project: 'todo-api' } } });
    expect(t.client.sessionId).toBe('new-1');
    expect(t.client.modes?.currentModeId).toBe('default');
  });

  it('an existing thread opens with session/load, which has no deadline (a long history takes a while)', async () => {
    const t = setup({ sessionId: 'old', requestTimeoutMs: 20 });
    await connect(t);
    const p = t.client.ensureSession();
    await flush();
    expect(t.ws.request('session/load')!.params).toMatchObject({ sessionId: 'old' });
    await new Promise((r) => setTimeout(r, 60));
    t.ws.reply('session/load', { modes: MODES });
    expect(await p).toBe('old');
  });

  it('a mode and provider picked before the first message go out right after session/new', async () => {
    const t = setup();
    await connect(t);
    await t.client.setMode('plan');
    t.client.beforeSession = { ...t.client.beforeSession, provider: { name: 'gemini', model: 'gemini-flash' } };
    const p = t.client.ensureSession();
    await flush();
    t.ws.reply('session/new', { sessionId: 's1', modes: MODES });
    await flush();
    expect(t.ws.request('session/set_mode')!.params).toEqual({ sessionId: 's1', modeId: 'plan' });
    t.ws.reply('session/set_mode', {});
    await flush();
    expect(t.ws.request('_hearth/thread/provider')!.params).toEqual({ sessionId: 's1', provider: 'gemini', model: 'gemini-flash' });
    t.ws.reply('_hearth/thread/provider', {});
    expect(await p).toBe('s1');
    expect(t.ws.methods()).toEqual(['initialize', 'session/new', 'session/set_mode', '_hearth/thread/provider']);
    // N1: the thread opens in the mode just set, not the one session/new reported before it.
    expect(t.client.modes?.currentModeId).toBe('plan');
  });

  it.fails('a mode the server refuses before the first message stops that message (AcpClient.ts: the error is swallowed)', async () => {
    const t = setup();
    await connect(t);
    await t.client.setMode('plan');
    const prompt = t.client.prompt([{ type: 'text', text: 'Plan it' }]);
    prompt.catch(() => {});
    await flush();
    t.ws.reply('session/new', { sessionId: 's1', modes: MODES });
    await flush();
    t.ws.replyError('session/set_mode', 'Plan mode is off for this project');
    await flush();
    expect(t.ws.request('session/prompt')).toBeUndefined();
    await expect(prompt).rejects.toThrow(/mode/i);
  });

  it('a server without session/load makes a dropped thread start over', async () => {
    const t = setup();
    await connect(t, { ...INIT, agentCapabilities: { ...INIT.agentCapabilities, loadSession: false } });
    const p = t.client.ensureSession();
    await flush();
    t.ws.reply('session/new', { sessionId: 's1' });
    await p;
    t.ws.drop();
    const again = t.client.ensureSession();
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', { ...INIT, agentCapabilities: { ...INIT.agentCapabilities, loadSession: false } });
    await expect(again).rejects.toThrow(/Start a new thread to continue/);
  });
});

describe('a turn', () => {
  it('session/prompt has no deadline (a long command can be silent; the thread pane says so after 5 minutes instead)', async () => {
    vi.useFakeTimers();
    const t = setup();
    await openSession(t);
    let settled = false;
    const p = t.client.prompt([{ type: 'text', text: 'hi' }]).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
    t.ws.reply('session/prompt', { stopReason: 'end_turn' });
    expect(await p).toBe('end_turn');
  });

  it("Stop on a turn this window didn't start asks the server to stop it, every time", async () => {
    const t = setup({ sessionId: 's1' });
    const controller = new AcpThreadController({ client: t.client });
    controller.attach();
    const loading = controller.load();
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', INIT);
    await flush();
    t.ws.reply('session/load', { modes: MODES, _meta: { hearth: { status: 'running' } } });
    await loading;
    expect(controller.getState().remoteRunning).toBe(true);
    await controller.cancel();
    await controller.cancel();
    expect(t.ws.sent.filter((f) => f.method === 'session/cancel')).toHaveLength(2);
  });

  it('an aborted signal stops the turn before it is sent, even while the session opens', async () => {
    const t = setup();
    await connect(t);
    const abort = new AbortController();
    const p = t.client.prompt([{ type: 'text', text: 'hi' }], abort.signal);
    await flush();
    abort.abort();
    t.ws.reply('session/new', { sessionId: 's1' });
    expect(await p).toBe('cancelled');
    expect(t.ws.request('session/prompt')).toBeUndefined();
  });

  it('cancel sends session/cancel once', async () => {
    const t = setup();
    await openSession(t);
    void t.client.prompt([{ type: 'text', text: 'hi' }]);
    await t.client.cancel();
    await t.client.cancel();
    expect(t.ws.sent.filter((f) => f.method === 'session/cancel')).toEqual([{ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's1' } }]);
  });

  it("only the current session's updates are delivered; extension notifications go to their own listeners", async () => {
    const t = setup();
    await openSession(t);
    const updates: string[] = [];
    const ext: string[] = [];
    t.client.subscribeSessionUpdate((sid, u) => updates.push(`${sid}:${u.sessionUpdate}`));
    t.client.subscribeExtNotification((m) => ext.push(m));
    t.ws.update('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } });
    t.ws.update('other', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'b' } });
    t.ws.receive({ method: '_hearth/plan_changed', params: { sessionId: 's1' } });
    expect(updates).toEqual(['s1:agent_message_chunk']);
    expect(ext).toEqual(['_hearth/plan_changed']);
  });
});

describe('permissions', () => {
  it('asks the registered handler and sends its answer', async () => {
    const t = setup();
    await openSession(t);
    t.client.registerPermissionHandler(() => ({ outcome: 'selected', optionId: 'yes' }));
    t.ws.receive(permissionRequest(99));
    await flush();
    expect(t.ws.sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 99, result: { outcome: { outcome: 'selected', optionId: 'yes' } } });
  });

  it('with no handler, or for another session, the answer is "cancelled"', async () => {
    const t = setup();
    await openSession(t);
    t.ws.receive(permissionRequest(501));
    t.ws.receive(permissionRequest(502, 'other'));
    await flush();
    expect(t.ws.sent.filter((f) => f.id === 501 || f.id === 502).map((f) => f.result)).toEqual([{ outcome: { outcome: 'cancelled' } }, { outcome: { outcome: 'cancelled' } }]);
  });

  it('refuses malformed requests and methods it does not have', async () => {
    const t = setup();
    await openSession(t);
    t.ws.receive({ id: 5, method: 'session/request_permission', params: { sessionId: 's1' } });
    t.ws.receive({ id: 6, method: 'fs/read_text_file', params: {} });
    expect(t.ws.sent.find((f) => f.id === 5)!.error.code).toBe(-32602);
    expect(t.ws.sent.find((f) => f.id === 6)!.error.code).toBe(-32601);
  });

  describe('in a thread (controller)', () => {
    /** A controller with a running turn waiting on permission request 99. */
    async function waiting() {
      const t = setup();
      const controller = new AcpThreadController({ client: t.client });
      controller.attach();
      const loading = controller.load();
      t.ws.onopen!();
      await flush();
      t.ws.reply('initialize', INIT);
      await loading;
      void controller.append({ role: 'user', content: [{ type: 'text', text: 'Run the tests' }], parentId: null, sourceId: null, runConfig: undefined, attachments: [], metadata: { custom: {} }, createdAt: new Date() } as never);
      await flush();
      t.ws.reply('session/new', { sessionId: 's1', modes: MODES });
      await flush();
      expect(t.ws.request('session/prompt')).toBeDefined();
      t.ws.receive(permissionRequest(99));
      await flush();
      expect(Object.keys(controller.getState().permissions)).toHaveLength(1);
      return { t, controller };
    }

    it('an answer in the window is sent back and the turn goes on', async () => {
      const { t, controller } = await waiting();
      const [approvalId] = Object.keys(controller.getState().permissions);
      await controller.respondToApproval({ approvalId: approvalId!, approved: true, optionId: 'yes' } as never);
      await flush();
      expect(t.ws.sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 99, result: { outcome: { outcome: 'selected', optionId: 'yes' } } });
      expect(controller.getState().permissions).toEqual({});
    });

    it.fails('a request the server withdraws ($/cancel_request: answered on another device) stops waiting here (AcpClient.ts ignores it)', async () => {
      const { t, controller } = await waiting();
      t.ws.receive({ method: '$/cancel_request', params: { requestId: 99 } });
      await flush();
      expect(controller.getState().permissions).toEqual({});
    });

    it('a dropped socket cancels the open permission and ends the turn with an error', async () => {
      const { t, controller } = await waiting();
      t.ws.drop();
      await flush();
      await flush();
      const state = controller.getState();
      expect(state.permissions).toEqual({});
      expect(state.run).toEqual({ type: 'idle' });
      const last = state.messagesById[state.messageOrder.at(-1)!] as { status: unknown };
      expect(last.status).toEqual({ type: 'incomplete', reason: 'error', error: 'ACP WebSocket connection closed' });
    });
  });
});

describe('a thread left while it opens (N2)', () => {
  it('reports nothing once the controller is detached, "AcpClient disposed" included', async () => {
    const t = setup({ sessionId: 'old' });
    const errors: string[] = [];
    const controller = new AcpThreadController({ client: t.client, onError: (e) => errors.push(e.message) });
    controller.attach();
    const loading = controller.load();
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', INIT);
    await flush();
    expect(t.ws.request('session/load')).toBeDefined(); // still opening
    await controller.detach(); // the thread pane went away
    t.client.dispose();
    await loading;
    expect(errors).toEqual([]);
  });

  it('a thread still on screen does report a failed open', async () => {
    const t = setup({ sessionId: 'old' });
    const errors: string[] = [];
    const controller = new AcpThreadController({ client: t.client, onError: (e) => errors.push(e.message) });
    controller.attach();
    const loading = controller.load();
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', INIT);
    await flush();
    t.ws.replyError('session/load', 'Resource not found', -32002);
    await loading;
    expect(errors).toEqual(['Resource not found']);
  });
});

describe('heartbeat', () => {
  const quiet = () => setup({ heartbeatMs: 1000, heartbeatTimeoutMs: 500 });

  it('a socket that answers nothing is dropped, so the owner can reconnect', async () => {
    vi.useFakeTimers();
    const t = quiet();
    await openSession(t);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.ws.request('_hearth/ping')).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(t.client.connectionState).toBe('disconnected');
    expect(t.ws.closed).toBe(true);
  });

  it('any answer keeps it, "method not found" included', async () => {
    vi.useFakeTimers();
    const t = quiet();
    await openSession(t);
    await vi.advanceTimersByTimeAsync(1000);
    t.ws.replyError('_hearth/ping', 'Method not found', -32601);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.client.connectionState).toBe('connected');
  });

  it('no ping while the socket is busy', async () => {
    vi.useFakeTimers();
    const t = quiet();
    await openSession(t);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(400);
      t.ws.update('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } });
    }
    expect(t.ws.request('_hearth/ping')).toBeUndefined();
    expect(t.client.connectionState).toBe('connected');
  });

  it('stops with the client', async () => {
    vi.useFakeTimers();
    const t = quiet();
    await openSession(t);
    t.client.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.ws.request('_hearth/ping')).toBeUndefined();
  });
});

describe('a dropped connection', () => {
  it('fails what was waiting, and the next open reloads the same session without repeating its history', async () => {
    const t = setup();
    await openSession(t);
    const pending = t.client.extRequest('_hearth/plan', { sessionId: 's1' });
    t.ws.drop();
    await expect(pending).rejects.toThrow('ACP WebSocket connection closed');
    expect(t.client.connectionState).toBe('disconnected');
    expect(t.client.sessionId).toBeUndefined();

    const updates: string[] = [];
    t.client.subscribeSessionUpdate((_sid, u) => updates.push((u as { content?: { text?: string } }).content?.text ?? u.sessionUpdate));
    const again = t.client.ensureSession();
    expect(t.sockets).toHaveLength(2);
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', INIT);
    await flush();
    expect(t.ws.request('session/load')!.params).toMatchObject({ sessionId: 's1' });
    t.ws.update('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed' } });
    t.ws.reply('session/load', { modes: MODES });
    expect(await again).toBe('s1');
    t.ws.update('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'live' } });
    expect(updates).toEqual(['live']);
  });

  it('a reload that keeps replaying is not cut off by the deadline', async () => {
    const t = setup({ requestTimeoutMs: 40 });
    await openSession(t);
    t.ws.drop();
    const again = t.client.ensureSession();
    t.ws.onopen!();
    await flush();
    t.ws.reply('initialize', INIT);
    await flush();
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 25)); t.ws.update('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${i}` } }); }
    t.ws.reply('session/load', {});
    expect(await again).toBe('s1');
  });

  it('dispose fails what was waiting and closes the socket', async () => {
    const t = setup();
    await openSession(t);
    const pending = t.client.extRequest('_hearth/files', { sessionId: 's1' });
    t.client.dispose();
    await expect(pending).rejects.toThrow('AcpClient disposed');
    expect(t.ws.closed).toBe(true);
    await expect(t.client.connect()).rejects.toThrow('AcpClient is disposed');
  });
});
