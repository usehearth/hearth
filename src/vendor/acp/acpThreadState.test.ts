// The thread reducer: one ACP thread's transcript, its running turn and its approvals, built from events.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ACP_THREAD_STATE,
  reduceAcpThreadState,
  splitAttached,
  splitContext,
  type AcpAssistantMessage,
  type AcpThreadEvent,
  type AcpThreadState,
  type AcpUserMessage,
} from './acpThreadState';

const reduce = (events: AcpThreadEvent[], from: AcpThreadState = EMPTY_ACP_THREAD_STATE) => events.reduce(reduceAcpThreadState, from);
const update = (u: Record<string, unknown>): AcpThreadEvent => ({ type: 'session-update', update: u as never });
const text = (t: string) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
const userText = (t: string) => update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: t } });
const tool = (id: string, extra: Record<string, unknown> = {}) => update({ sessionUpdate: 'tool_call', toolCallId: id, title: `Tool ${id}`, kind: 'execute', status: 'pending', ...extra });
const toolUpdate = (id: string, extra: Record<string, unknown>) => update({ sessionUpdate: 'tool_call_update', toolCallId: id, ...extra });
const assistant = (id: string): AcpAssistantMessage => ({ role: 'assistant', id, parentId: null, createdAt: 0, status: { type: 'running' }, content: [] });
const user = (id: string, t: string) => ({ type: 'append-message' as const, message: { role: 'user' as const, id, parentId: null, createdAt: 0, content: [{ type: 'text' as const, text: t }], attachments: [] } });
const msg = (s: AcpThreadState, id: string) => s.messagesById[id] as AcpAssistantMessage;
const permission = (approvalId: string, toolCallId: string): AcpThreadEvent => ({
  type: 'permission-request', approvalId,
  request: { sessionId: 's', toolCall: { toolCallId, title: 'npm test' }, options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }, { optionId: 'no', name: 'No', kind: 'reject_once' }] } as never,
});

describe('a turn run by this window', () => {
  it('streams text into the running message and ends with the stop status', () => {
    const s = reduce([user('u1', 'hi'), { type: 'run-start', message: assistant('a1') }, text('Hel'), text('lo')]);
    expect(s.run).toEqual({ type: 'running', assistantId: 'a1' });
    expect(msg(s, 'a1').content).toEqual([{ type: 'text', text: 'Hello' }]);
    const done = reduce([{ type: 'run-end', assistantId: 'a1', status: { type: 'complete', reason: 'stop' } }], s);
    expect(done.run).toEqual({ type: 'idle' });
    expect(msg(done, 'a1').status).toEqual({ type: 'complete', reason: 'stop' });
    expect(done.messageOrder).toEqual(['u1', 'a1']);
  });

  it('adds tool calls and merges their updates', () => {
    const s = reduce([{ type: 'run-start', message: assistant('a1') }, tool('t1'), toolUpdate('t1', { status: 'completed', title: 'npm test' })]);
    const parts = msg(s, 'a1').content;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'tool-call', toolCallId: 't1' });
  });

  it('puts a permission on its tool call and waits; an answer resumes the turn', () => {
    const asked = reduce([{ type: 'run-start', message: assistant('a1') }, tool('t1'), permission('p1', 't1')]);
    expect(msg(asked, 'a1').status).toEqual({ type: 'requires-action', reason: 'tool-calls' });
    expect(Object.keys(asked.permissions)).toEqual(['p1']);
    expect(msg(asked, 'a1').content[0]).toMatchObject({ type: 'tool-call', approval: { id: 'p1' } });
    const answered = reduce([{ type: 'permission-resolved', approvalId: 'p1', approved: true, optionId: 'yes', cancelled: false }], asked);
    expect(answered.permissions).toEqual({});
    expect(msg(answered, 'a1').status).toEqual({ type: 'running' });
    expect(msg(answered, 'a1').content[0]).toMatchObject({ approval: { id: 'p1', approved: true, optionId: 'yes' } });
  });

  it('a stop cancels open permissions', () => {
    const s = reduce([{ type: 'run-start', message: assistant('a1') }, tool('t1'), permission('p1', 't1'), { type: 'permissions-cancelled' }]);
    expect(s.permissions).toEqual({});
    expect(msg(s, 'a1').content[0]).toMatchObject({ approval: { resolution: 'cancelled' } });
  });

  it('a permission with no turn running here is ignored (it shows as a card instead)', () => {
    const s = reduce([permission('p1', 't1')]);
    expect(s).toBe(EMPTY_ACP_THREAD_STATE);
  });

  it('while a stopped turn settles, its tool calls still land on it but its text does not', () => {
    const stopped = reduce([{ type: 'run-start', message: assistant('a1') }, text('Working'), { type: 'run-end', assistantId: 'a1', status: { type: 'incomplete', reason: 'cancelled' }, settling: true }]);
    expect(stopped.settlingAssistantId).toBe('a1');
    const late = reduce([text(' more'), tool('t1')], stopped);
    expect(msg(late, 'a1').content).toEqual([{ type: 'text', text: 'Working' }, expect.objectContaining({ type: 'tool-call', toolCallId: 't1' })]);
    expect(reduce([{ type: 'run-settled', assistantId: 'a1' }], late).settlingAssistantId).toBeUndefined();
  });

  it('a run-end for another message changes nothing', () => {
    const s = reduce([{ type: 'run-start', message: assistant('a1') }]);
    expect(reduce([{ type: 'run-end', assistantId: 'other', status: { type: 'complete', reason: 'stop' } }], s)).toBe(s);
  });
});

describe('history and other windows (no turn of ours running)', () => {
  it('builds user and assistant messages from a replay', () => {
    const s = reduce([userText('Run the tests'), text('Running '), tool('t1'), text('done.'), userText('Thanks'), text('Any time.')]);
    const roles = s.messageOrder.map((id) => s.messagesById[id]!.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
    const first = s.messagesById[s.messageOrder[1]!] as AcpAssistantMessage;
    expect(first.content.map((p) => p.type)).toEqual(['text', 'tool-call', 'text']);
  });

  it('joins a user message sent in several chunks', () => {
    const s = reduce([userText('Hello '), userText('there')]);
    expect(s.messageOrder).toHaveLength(1);
    expect(s.messagesById[s.messageOrder[0]!]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Hello there' }] });
  });

  it('builds a replayed turn as finished, even one the server is still running (see faults.spec.ts: drop mid-turn)', () => {
    // Nothing in a replay says the turn is still going: the server's status rides on session_info_update, which only
    // the title is read from. So after a reconnect a running turn shows as finished, with no Stop.
    const s = reduce([userText('Count slowly'), text('Step 1. '), update({ sessionUpdate: 'session_info_update', title: 'Count', _meta: { hearth: { status: 'running' } } }), text('Step 2. ')]);
    const last = s.messagesById[s.messageOrder.at(-1)!] as AcpAssistantMessage;
    expect(last.status).toEqual({ type: 'complete', reason: 'unknown' });
    expect(s.run).toEqual({ type: 'idle' });
    expect(s.sessionTitle).toBe('Count');
  });

  it('shows embedded files and saved attachments as file chips, not text', () => {
    const s = reduce([userText('Look at this\n<context ref="file:///notes.md">\n# Notes\n</context>\n[attached: uploads/20261119-101500-photo.png]')]);
    const m = s.messagesById[s.messageOrder[0]!] as AcpUserMessage;
    expect(m.content).toEqual([{ type: 'text', text: 'Look at this' }]);
    expect(m.attachments.map((a) => a.name)).toEqual(['notes.md', 'photo.png']);
  });
});

describe('thread-wide updates', () => {
  it('keeps the title, mode, commands, config and usage', () => {
    const s = reduce([
      update({ sessionUpdate: 'session_info_update', title: 'Fix the bug' }),
      update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }),
      update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: '' }] }),
      update({ sessionUpdate: 'usage_update', used: 10, size: 100 }),
      update({ sessionUpdate: 'plan', entries: [{ content: 'Step', status: 'pending', priority: 'medium' }] }),
    ]);
    expect(s).toMatchObject({ sessionTitle: 'Fix the bug', currentModeId: 'plan', usage: { used: 10, size: 100, cost: null } });
    expect(s.availableCommands).toHaveLength(1);
    expect(s.plan).toHaveLength(1);
  });

  it('ignores cards (Hearth draws them itself)', () => {
    const s = reduce([update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Approve?' }, _meta: { hearth: { card: { id: 'c1' } } } })]);
    expect(s).toBe(EMPTY_ACP_THREAD_STATE);
  });

  it('a session opening sets the mode it reports; a reconnect to the same session keeps the live one', () => {
    const opened = reduce([{ type: 'connection', connectionState: 'connected', sessionId: 's1', sessionModes: { currentModeId: 'acceptEdits', availableModes: [] } }]);
    expect(opened.currentModeId).toBe('acceptEdits');
    const changed = reduce([update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }), { type: 'connection', connectionState: 'connected', sessionId: 's1', sessionModes: { currentModeId: 'default', availableModes: [] } }], opened);
    expect(changed.currentModeId).toBe('plan');
  });

  it('a reset clears the transcript but keeps the connection', () => {
    const s = reduce([{ type: 'connection', connectionState: 'connected', sessionId: 's1' }, userText('hi'), { type: 'reset', threadId: 't2' }]);
    expect(s).toMatchObject({ threadId: 't2', connectionState: 'connected', messageOrder: [], sessionId: undefined });
  });
});

describe('splitContext / splitAttached', () => {
  it('leave plain text alone', () => {
    expect(splitContext('plain')).toEqual({ text: 'plain', files: [] });
    expect(splitAttached('plain')).toEqual({ text: 'plain', files: [] });
  });
});
