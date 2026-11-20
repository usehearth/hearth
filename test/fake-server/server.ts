// A fake Hearth server for tests: ACP over a WebSocket (`/acp`, key as a `bearer.<key>` subprotocol), the `_hearth/*`
// methods a normal session uses, and recorded turns replayed as scripts (fixtures.ts). The server owns the threads as
// the real one does: a turn keeps running when a socket drops, and `session/load` replays everything said so far.
//
// Faults, for drills: drop every socket, stop listening for a while (a restart), delay replies, never reply to a
// method, fail a method, answer a permission "from another device", and go silent on open sockets (half-open).
//
// Plain Node (type stripping): `node test/fake-server/cli.ts` runs one by hand; tests call startFakeServer().
import http from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { historyOf, loadFixture, scriptFor, type Script, type Step, type Update } from './fixtures.ts';

export interface Card {
  id: string; kind: string; label: string; title: string; why: string; status: string;
  answerable: 'permission' | 'approve_deny' | 'text'; createdAt: string; decidedBy?: string | null; answer?: string | null;
  options?: { optionId: string; name: string; kind: string }[]; toolCall?: { title?: string; rawInput?: unknown } | null;
}

export interface Thread {
  id: string; title: string; project: string; projectName: string; cwd: string; kind: 'main' | 'work';
  updatedAt: string; status: 'idle' | 'running' | 'needs_permission'; pinned: boolean; archived: boolean;
  history: Update[]; modeId: string; provider: string | null; plan: string | null; cards: Card[]; deleted?: boolean;
}

export interface Project { slug: string; name: string; cwd: string }

export interface Call { method: string; params: any; conn: number; at: number }

interface Conn { id: number; ws: WebSocket; attached: Set<string>; silent: boolean; nextId: number; waiting: Map<number, (r: any) => void> }

interface Turn {
  sessionId: string; script: Script; cancelled: boolean; conn: Conn; reply: ((result: unknown, error?: { code: number; message: string }) => void) | null;
  /** A permission the turn waits on: answered by a window (first answer wins), a card answer, or "another device". */
  perm: { cardId: string; asked: Map<Conn, number>; resolve: (optionId: string | null, by: string) => void; askOne: (c: Conn) => void } | null;
}

export interface FakeServerOptions {
  port?: number;
  key?: string;
  /** Multiplies the recorded gaps between frames (0.1: ten times faster). */
  speed?: number;
  /** The longest pause between two frames, in ms, after `speed`. */
  maxGap?: number;
  /** `session/list` page size (the app asks again while there is a nextCursor). */
  pageSize?: number;
  /** Replaces the default world. */
  world?: { projects: Project[]; threads: Partial<Thread>[] };
  /** `_hearth` extensions announced in `initialize`. */
  extensions?: string[];
  title?: string;
  /**
   * How a socket is refused. 'http' (default): at the upgrade with 401 or 429, as core does today (a browser sees only
   * a failed connection). 'close': the socket opens and closes with 4401 (key refused) or 4429 ("retry in <seconds>"), and
   * initialize says so (`_meta.hearth.refusals: "close"`), as proposed for core.
   */
  refusals?: 'http' | 'close';
  /** Wrong keys allowed in `lockoutMs` before every socket is refused for a while (core: 5 in 15 minutes). */
  lockoutAfter?: number;
  lockoutMs?: number;
}

export const DEFAULT_KEY = 'test-device-key';
export const EXTENSIONS = ['plan', 'cards', 'device', 'providers', 'files', 'clients', 'threads', 'modes', 'permissions', 'extensions', 'mcp', 'commands', 'new_project', 'history', 'import'];

const COMMANDS = [
  { name: 'compact', description: 'Clear the conversation but keep a summary in context', input: { hint: '<optional instructions>' } },
  { name: 'context', description: 'Show how full the context window is', input: null },
  { name: 'init', description: 'Write a CLAUDE.md for this project', input: null },
  { name: 'review', description: 'Review the current changes', input: null },
];
const MODES = { currentModeId: 'default', availableModes: [
  { id: 'default', name: 'Ask', description: 'Asks before anything not pre-approved' },
  { id: 'acceptEdits', name: 'Accept edits', description: 'Edits inside the project without asking; still asks for the rest' },
  { id: 'plan', name: 'Plan', description: 'Reads and plans; changes nothing' },
] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** Two projects with a main thread each and a few finished threads made from the recordings, plus two open cards. */
export function defaultWorld(): { projects: Project[]; threads: Partial<Thread>[] } {
  const projects = [
    { slug: 'todo-api', name: 'Todo API', cwd: '/workspace/todo-api' },
    { slug: 'scratch', name: 'Scratch', cwd: '/workspace/scratch' },
  ];
  const card = (id: string, title: string, why: string): Card => ({ id, kind: 'approval', label: 'Approval', title, why, status: 'open', answerable: 'approve_deny', createdAt: iso(3) });
  return {
    projects,
    threads: [
      { id: 'main-todo', title: 'Main thread', project: 'todo-api', kind: 'main', updatedAt: iso(1), history: historyOf(scriptFor('Say hello'), 'Say hello') },
      { id: 't-subagent', title: 'Count exports with a subagent', project: 'todo-api', updatedAt: iso(5), history: historyOf(loadFixture('subagent')) },
      { id: 't-tests', title: 'Run the tests', project: 'todo-api', updatedAt: iso(9), history: historyOf(loadFixture('permission')) },
      { id: 't-fix', title: 'Fix the completed flag', project: 'todo-api', updatedAt: iso(14), history: historyOf(loadFixture('plan-and-edits')), plan: '# Plan\n\n1. Find the bug\n2. Fix it\n3. Run the tests' },
      { id: 't-waiting', title: 'Deploy notes', project: 'todo-api', updatedAt: iso(20), history: historyOf(scriptFor('Draft deploy notes'), 'Draft deploy notes'),
        cards: [card('card-deploy', 'Merge the deploy notes?', 'A worker finished the notes and wants to merge them.')] },
      { id: 'main-scratch', title: 'Main thread', project: 'scratch', kind: 'main', updatedAt: iso(60), history: [] },
      { id: 't-notes', title: 'Scratch notes', project: 'scratch', updatedAt: iso(90), history: historyOf(scriptFor('Take a note'), 'Take a note'),
        cards: [card('card-notes', 'Keep the scratch notes?', 'Nothing else uses them.')] },
    ],
  };
}

export type FakeServer = Awaited<ReturnType<typeof startFakeServer>>;

export async function startFakeServer(opts: FakeServerOptions = {}) {
  const key = opts.key ?? DEFAULT_KEY;
  /** Device keys the server takes (revokeKey swaps them). */
  const keys = new Set([key]);
  /** WebSocket upgrades refused for a wrong or revoked key (the real server counts these toward a lockout). */
  let refusedUpgrades = 0;
  /** Sockets refused because of the lockout, and when the wrong keys that count toward it came. */
  let lockedRefusals = 0;
  const badKeys: number[] = [];
  const refusals = opts.refusals ?? 'http';
  const lockoutAfter = opts.lockoutAfter ?? 5;
  const lockoutMs = opts.lockoutMs ?? 15 * 60_000;
  const speed = opts.speed ?? 0.1;
  const maxGap = opts.maxGap ?? 250;
  const pageSize = opts.pageSize ?? 50;
  const extensions = opts.extensions ?? EXTENSIONS;
  const world = opts.world ?? defaultWorld();
  const projects = new Map(world.projects.map((p) => [p.slug, p]));
  const threads = new Map<string, Thread>();
  for (const t of world.threads) {
    const p = projects.get(t.project!)!;
    threads.set(t.id!, {
      title: 'Untitled', kind: 'work', updatedAt: iso(30), status: t.cards?.length ? 'needs_permission' : 'idle', pinned: false, archived: false,
      history: [], modeId: 'default', provider: null, plan: null, cards: [], projectName: p.name, cwd: p.cwd, ...t,
    } as Thread);
  }

  const conns = new Set<Conn>();
  const turns = new Map<string, Turn>();
  const calls: Call[] = [];
  const unknown: string[] = [];
  const faults = {
    delayMs: 0,
    blackhole: new Set<string>(),
    fail: new Map<string, { times: number; code: number; message: string; match: (params: any) => boolean }>(),
  };
  /** Error replies sent (method and message), faults included. */
  const errors: { method: string; message: string }[] = [];
  const imports = { runs: 0, files: new Map<string, number>() };
  let connIds = 0;
  let newIds = 0;
  let cardIds = 0;

  // ---------- transport ----------

  const send = (c: Conn, frame: unknown) => {
    if (c.silent || c.ws.readyState !== c.ws.OPEN) return;
    c.ws.send(JSON.stringify(frame));
  };
  const notify = (c: Conn, method: string, params: unknown) => send(c, { jsonrpc: '2.0', method, params });
  const notifyAll = (method: string, params: unknown) => { for (const c of conns) notify(c, method, params); };
  /** A server-to-client request; resolves with the client's result (or never, if the socket goes). */
  const ask = (c: Conn, method: string, params: unknown) => {
    const id = c.nextId++;
    const done = new Promise<any>((resolve) => c.waiting.set(id, resolve));
    send(c, { jsonrpc: '2.0', id, method, params });
    return { id, done };
  };

  const update = (t: Thread, u: Update, opts: { record?: boolean; except?: Conn } = {}) => {
    if (opts.record !== false) t.history.push(u);
    for (const c of conns) if (c !== opts.except && c.attached.has(t.id)) notify(c, 'session/update', { sessionId: t.id, update: u });
  };
  const listChanged = (ids: string[]) => notifyAll('_hearth/sessions_changed', { sessionIds: ids });
  const setStatus = (t: Thread, status: Thread['status']) => {
    t.status = status;
    t.updatedAt = new Date().toISOString();
    update(t, { sessionUpdate: 'session_info_update', title: t.title, updatedAt: t.updatedAt, _meta: { hearth: { status, runnerOnline: true } } }, { record: false });
    listChanged([t.id]);
  };

  // ---------- views ----------

  const listItem = (t: Thread) => ({
    sessionId: t.id, title: t.title, cwd: t.cwd, updatedAt: t.updatedAt,
    _meta: { hearth: { project: t.project, projectName: t.projectName, kind: t.kind, status: t.status, runnerOnline: true, pinned: t.pinned,
      openCards: t.cards.filter((c) => c.status === 'open').length, ...(t.archived ? { archived: true } : {}) } },
  });
  const cardEntry = (t: Thread, card: Card) => ({ sessionId: t.id, title: t.title, project: t.project, projectName: t.projectName, kind: t.kind, cwd: t.cwd, card });
  const live = () => [...threads.values()].filter((t) => !t.deleted);
  const sessionResult = (t: Thread) => ({ modes: { ...MODES, currentModeId: t.modeId }, configOptions: null, _meta: { hearth: { project: t.project, kind: t.kind, title: t.title, provider: t.provider, model: null } } });
  const thread = (params: any) => {
    const t = threads.get(String(params?.sessionId));
    if (!t || t.deleted) throw { code: -32002, message: 'Resource not found' };
    return t;
  };

  // ---------- turns ----------

  async function runTurn(t: Thread, script: Script, conn: Conn, reply: Turn['reply']) {
    const turn: Turn = { sessionId: t.id, script, cancelled: false, conn, reply, perm: null };
    turns.set(t.id, turn);
    setStatus(t, 'running');
    let last = 0;
    let stopReason = 'end_turn';
    let failed: string | null = null;
    let always: string | null = null;
    for (const [i, s] of script.steps.entries()) {
      const wait = script.realtime ? Math.max(0, s.t - last) : Math.min(maxGap, Math.max(0, (s.t - last) * speed));
      last = s.t;
      if (wait) await sleep(wait);
      if (turn.cancelled) { stopReason = 'cancelled'; break; }
      if (s.kind === 'update') {
        const text = (s.update as any).content?.text;
        // "[From now on: …]" is the server's own line after an "always" answer: only when one was given.
        if (typeof text === 'string' && text.includes('[From now on:')) { if (always) update(t, { ...s.update, content: { type: 'text', text: `\n[From now on: ${always}]\n` } }); continue; }
        update(t, s.update);
      } else if (s.kind === 'ext') {
        notifyAll(s.method, { sessionId: t.id });
      } else if (s.kind === 'permission') {
        const next = script.steps[i + 1];
        if (next?.kind === 'elsewhere') setTimeout(() => turn.perm?.resolve(next.optionId, 'another device'), next.afterMs);
        const answer = await askPermission(t, turn, s);
        if (turn.cancelled) { stopReason = 'cancelled'; break; }
        if (!answer || /reject/.test(answer)) {
          update(t, { sessionUpdate: 'tool_call_update', toolCallId: String(s.params.toolCall.toolCallId), status: 'failed' } as Update);
          update(t, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'You said no, so I stopped there.' } });
          break;
        }
        if (/always/.test(answer)) always = `${String(s.params.toolCall.title ?? 'that')} is allowed in this ${answer.includes('project') ? 'project' : 'thread'}.`;
      } else if (s.kind === 'pause') {
        const until = Date.now() + s.ms;
        while (Date.now() < until && !turn.cancelled) await sleep(50);
      } else if (s.kind === 'drop') {
        conn.ws.terminate();
      } else if (s.kind === 'hang') {
        await new Promise<void>((resolve) => { const check = setInterval(() => { if (turn.cancelled) { clearInterval(check); resolve(); } }, 50); });
        stopReason = 'cancelled';
        break;
      } else if (s.kind === 'fail') {
        failed = s.message;
        break;
      } else if (s.kind === 'end') {
        stopReason = s.stopReason;
      }
    }
    if (turns.get(t.id) === turn) turns.delete(t.id);
    setStatus(t, 'idle');
    if (failed) turn.reply?.(undefined, { code: -32603, message: failed });
    else turn.reply?.({ stopReason });
    turn.reply = null;
  }

  /** Asks every window that has the thread open; the first answer wins and the others' requests are withdrawn. */
  function askPermission(t: Thread, turn: Turn, s: Extract<Step, { kind: 'permission' }>): Promise<string | null> {
    const card: Card = { id: `perm-${++cardIds}`, kind: 'permission', label: 'Permission', title: String(s.params.toolCall.title ?? 'Run a tool'), why: '', status: 'open',
      answerable: 'permission', createdAt: new Date().toISOString(), options: s.params.options, toolCall: { title: String(s.params.toolCall.title ?? '') } };
    t.cards.push(card);
    setStatus(t, 'needs_permission');
    notifyAll('_hearth/cards_changed', {});
    return new Promise((resolve) => {
      const asked = new Map<Conn, number>();
      let settled = false;
      const done = (optionId: string | null, by: string) => {
        if (settled) return;
        settled = true;
        turn.perm = null;
        for (const [c, id] of asked) {
          c.waiting.delete(id);
          notify(c, '$/cancel_request', { requestId: id }); // answered elsewhere: as the real server (ACP SDK cancellation)
        }
        card.status = optionId && !/reject/.test(optionId) ? 'approved' : 'denied';
        card.decidedBy = by;
        notifyAll('_hearth/cards_changed', {});
        if (t.status === 'needs_permission') setStatus(t, 'running');
        resolve(optionId);
      };
      const askOne = (c: Conn) => {
        const req = ask(c, 'session/request_permission', { sessionId: t.id, ...s.params });
        asked.set(c, req.id);
        void req.done.then((r) => {
          asked.delete(c);
          const out = r?.outcome;
          if (out?.outcome === 'selected' && typeof out.optionId === 'string') done(out.optionId, 'this window');
          // Dismissed ("cancelled"): the prompt stays open for the other windows and the card.
        });
      };
      turn.perm = { cardId: card.id, asked, resolve: done, askOne };
      for (const c of conns) if (c.attached.has(t.id)) askOne(c);
      const stop = setInterval(() => { if (turn.cancelled || settled) { clearInterval(stop); if (!settled) done(null, 'cancelled'); } }, 50);
    });
  }

  // ---------- methods ----------

  const methods: Record<string, (params: any, c: Conn, id: number | string | undefined) => unknown> = {
    initialize: () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: false, embeddedContext: true }, mcpCapabilities: { http: false, sse: false }, sessionCapabilities: { list: {}, resume: {}, close: {} } },
      agentInfo: { name: 'fake-hearth', title: opts.title ?? 'Fake Hearth', version: '0.0.0' },
      authMethods: [],
      _meta: { hearth: { version: 1, extensions, uploadMaxBytes: 15 * 1024 * 1024, ...(refusals === 'close' ? { refusals: 'close' } : {}) } },
    }),
    'session/list': (params) => {
      const archived = !!params?._meta?.hearth?.archived;
      const all = live().filter((t) => t.archived === archived).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const from = Number(params?.cursor ?? 0) || 0;
      const page = all.slice(from, from + pageSize);
      return { sessions: page.map(listItem), ...(from + pageSize < all.length ? { nextCursor: String(from + pageSize) } : {}) };
    },
    'session/new': (params, c) => {
      const slug = String(params?._meta?.hearth?.project ?? '');
      const p = projects.get(slug) ?? [...projects.values()].find((x) => x.cwd === params?.cwd);
      if (!p) throw { code: -32602, message: `No project ${slug || params?.cwd}` };
      const t: Thread = { id: `new-${++newIds}`, title: String(params?._meta?.hearth?.title ?? 'New thread'), project: p.slug, projectName: p.name, cwd: p.cwd, kind: 'work',
        updatedAt: new Date().toISOString(), status: 'idle', pinned: false, archived: false, history: [], modeId: 'default', provider: null, plan: null, cards: [] };
      threads.set(t.id, t);
      c.attached.add(t.id);
      // The thread reports its commands and mode as it opens (ahead of this reply: the client accepts that).
      update(t, { sessionUpdate: 'available_commands_update', availableCommands: COMMANDS });
      update(t, { sessionUpdate: 'current_mode_update', currentModeId: t.modeId });
      listChanged([t.id]);
      return { sessionId: t.id, ...sessionResult(t) };
    },
    'session/load': (params, c) => {
      const t = thread(params);
      for (const u of t.history) notify(c, 'session/update', { sessionId: t.id, update: u });
      c.attached.add(t.id);
      // A running turn's open permission prompt is asked in this window too, once it has the history.
      const perm = turns.get(t.id)?.perm;
      if (perm) setTimeout(() => perm.askOne(c), 50 + faults.delayMs);
      return sessionResult(t);
    },
    'session/prompt': (params, c) => {
      const t = thread(params);
      if (turns.has(t.id)) throw { code: -32600, message: 'A turn is already running in this thread. Wait for it or cancel it.' };
      const text = (params?.prompt ?? []).map((b: any) => (b?.type === 'text' ? b.text : '')).join('');
      const u: Update = { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } };
      update(t, u, { except: c }); // the sender already shows it
      if (t.title === 'New thread') { t.title = text.replace(/#\S+/g, '').trim().slice(0, 40) || 'New thread'; update(t, { sessionUpdate: 'session_info_update', title: t.title }, { record: false }); }
      return new Promise((resolve, reject) => {
        void runTurn(t, scriptFor(text), c, (result, error) => (error ? reject(error) : resolve(result)));
      });
    },
    'session/cancel': (params) => { const turn = turns.get(String(params?.sessionId)); if (turn) turn.cancelled = true; return undefined; },
    'session/set_mode': (params) => {
      const t = thread(params);
      t.modeId = String(params.modeId);
      update(t, { sessionUpdate: 'current_mode_update', currentModeId: t.modeId });
      return {};
    },
    'session/set_config_option': () => ({ configOptions: [] }),
    '_hearth/thread/provider': (params) => { const t = thread(params); t.provider = params.provider ?? null; return { provider: t.provider }; },
    '_hearth/device': () => ({ name: 'Test device', admin: true, workDevice: true }),
    '_hearth/devices': () => ({ devices: [{ id: 'd1', name: 'Test device', created_by: 'owner', created_at: iso(600), last_used_at: iso(0), revoked_at: null, current: true }] }),
    '_hearth/clients': () => ({ clients: [], workDevice: true }),
    '_hearth/history/counts': () => ({ projects: [], groups: [] }),
    // One imported Claude Code conversation, for the search over threads and history.
    '_hearth/history/search': (params) => {
      const q = String(params?.query ?? '').toLowerCase();
      const all = [{ id: 'h-deploy', title: 'Deploy checklist from Claude Code', source: 'claude-code', group: 'todo-api', project: 'todo-api', projectName: 'Todo API',
        startedAt: '2026-09-02T10:00:00Z', endedAt: '2026-09-02T10:30:00Z', messages: 12, threads: 1, client: false, snippet: 'run the migration before you deploy' }];
      return { hits: all.filter((h) => `${h.title} ${h.snippet}`.toLowerCase().includes(q)), clientUnavailable: false, titlesOnly: false };
    },
    '_hearth/cards': (params) => {
      const out = [];
      for (const t of live()) {
        if (params?.sessionId && t.id !== params.sessionId) continue;
        for (const card of t.cards) if (card.status === 'open') out.push(cardEntry(t, card));
      }
      return { cards: out };
    },
    '_hearth/card/answer': (params) => {
      const t = thread(params);
      const card = t.cards.find((x) => x.id === params.itemId);
      if (!card) throw { code: -32002, message: 'Resource not found' };
      if (card.status !== 'open') return { card };
      if (card.answerable === 'permission') {
        const turn = turns.get(t.id);
        if (turn?.perm?.cardId === card.id) turn.perm.resolve(params.decision === 'deny' ? 'reject' : String(params.optionId ?? 'allow-once'), 'Needs you');
      } else {
        card.status = params.decision === 'deny' ? 'denied' : params.decision === 'answer' ? 'answered' : 'approved';
        card.decidedBy = 'test';
        card.answer = params.text ?? null;
        if (!t.cards.some((x) => x.status === 'open') && t.status === 'needs_permission') setStatus(t, 'idle');
        notifyAll('_hearth/cards_changed', {});
      }
      return { card };
    },
    '_hearth/plan': (params) => { const t = thread(params); return { path: `${t.cwd}/.hearth/threads/${t.id}/plan.md`, text: t.plan, ...(t.plan ? {} : { note: 'No plan yet.' }) }; },
    '_hearth/files': (params) => { thread(params); return { files: [] }; },
    '_hearth/commands': () => ({ availableCommands: COMMANDS }),
    '_hearth/providers': () => ({ providers: [{ name: 'claude', kind: 'anthropic', enabled: true, status: 'ok', models: {} }, { name: 'gemini', kind: 'openai', enabled: true, status: 'ok', models: { default: 'gemini-flash' } }], canEdit: true }),
    '_hearth/thread/archive': (params) => { const t = thread(params); t.archived = !!params.archived; listChanged([t.id]); return {}; },
    '_hearth/thread/pin': (params) => { const t = thread(params); t.pinned = !!params.pinned; listChanged([t.id]); return {}; },
    '_hearth/thread/rename': (params) => { const t = thread(params); t.title = String(params.title); listChanged([t.id]); return {}; },
    '_hearth/thread/delete': (params) => { const t = thread(params); t.deleted = true; listChanged([t.id]); return {}; },
    '_hearth/threads/search': (params) => {
      const q = String(params?.query ?? '').toLowerCase();
      return { results: live().filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ sessionId: t.id, project: t.projectName, title: t.title, updatedAt: t.updatedAt, client: false, snippet: null })) };
    },
    '_hearth/mcp': () => ({ servers: [
      { name: 'linear', title: 'Linear', url: 'https://mcp.linear.example/sse', client: null, enabled: true, has_token: true, transport: 'http' },
      { name: 'ado', title: 'Azure DevOps', url: null, client: null, enabled: true, has_token: false, transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp'], env_names: ['AZURE_DEVOPS_PAT'] },
    ] }),
    '_hearth/mcp/test': () => ({ ok: true, tools: ['search', 'create_issue'], ms: 12 }),
    '_hearth/extensions': () => ({ extensions: [
      { id: 'x1', kind: 'command', name: 'standup', scope: 'global', description: 'Write a three-line standup', content: 'Write a standup: done, doing, blocked.', enabled: true, updated_at: iso(60) },
      { id: 'x2', kind: 'skill', name: 'house-style', scope: 'todo-api', description: 'How this project writes', content: 'Short sentences.', enabled: true, updated_at: iso(120) },
    ] }),
    '_hearth/import/info': () => ({ available: true, conversations: 0, sealed: 0, legacy: 0, projects: 0, lastRun: null }),
    '_hearth/import/preview': (params) => {
      const units: any[] = params?.units ?? [];
      const bytes = units.reduce((n, u) => n + (u.bytes ?? 0), 0);
      return {
        token: 'preview-1', pools: ['default'], defaultPool: 'default', clientPool: null, projects: [...projects.values()].map((p) => ({ slug: p.slug, name: p.name, client: null })),
        proposals: [{ key: 'chat:all', name: 'Claude chats', slug: 'claude-chats', path: '', client: null, existing: null, conversations: units.length, bytes, new: units.length, changed: 0, unchanged: 0, refile: 0, last: units[0]?.ended ?? null }],
        totals: { conversations: units.length, bytes, new: units.length, changed: 0, unchanged: 0, refile: 0 },
      };
    },
    '_hearth/import/begin': (params) => {
      const created = Object.values(params?.choices ?? {}).filter((c: any) => c?.action === 'new').map((c: any) => c.slug);
      imports.runs++;
      const pending = lastPreviewUnits;
      return { runId: imports.runs, created, upload: pending.map((u) => ({ id: u.id, folder: u.folder, uuid: u.uuid, files: u.files })), refiled: 0, unchanged: 0, skipped: 0, chunkBytes: 1 << 20 };
    },
    '_hearth/import/file': (params) => {
      const k = `${params.id}/${params.rel}`;
      const next = (imports.files.get(k) ?? 0) + Buffer.from(String(params.data ?? ''), 'base64').length;
      imports.files.set(k, next);
      return { next };
    },
    '_hearth/import/commit': () => ({ ok: true }),
    '_hearth/import/finish': (params) => ({ runId: params.runId, report: { uploaded: lastPreviewUnits.length } }),
    '_hearth/import/memories': (params) => ({ memories: (params?.files ?? []).length }),
  };
  let lastPreviewUnits: any[] = [];
  const preview = methods['_hearth/import/preview'];
  methods['_hearth/import/preview'] = (params, c, id) => { lastPreviewUnits = params?.units ?? []; return preview(params, c, id); };

  async function handle(c: Conn, raw: string) {
    if (c.silent) return; // half-open: what the client sends goes nowhere
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.method === undefined && msg.id !== undefined) { // a reply to one of our requests
      const w = c.waiting.get(msg.id);
      if (w) { c.waiting.delete(msg.id); w(msg.result); }
      return;
    }
    const method = String(msg.method);
    calls.push({ method, params: msg.params, conn: c.id, at: Date.now() });
    const isRequest = msg.id !== undefined;
    const fn = methods[method];
    const reply = async (frame: { result?: unknown; error?: { code: number; message: string } }) => {
      if (!isRequest) return;
      if (frame.error) errors.push({ method, message: frame.error.message });
      if (faults.delayMs) await sleep(faults.delayMs);
      send(c, { jsonrpc: '2.0', id: msg.id, ...frame });
    };
    if (faults.blackhole.has(method)) return;
    const fail = faults.fail.get(method);
    if (fail && fail.match(msg.params)) {
      if (--fail.times <= 0) faults.fail.delete(method);
      return reply({ error: { code: fail.code, message: fail.message } });
    }
    if (!fn) {
      // The app's heartbeat: core has no such method and answers "method not found", which proves the socket is alive.
      if (method !== '_hearth/ping') unknown.push(method);
      return reply({ error: { code: -32601, message: `Method not found: ${method}` } });
    }
    try {
      const result = await fn(msg.params, c, msg.id);
      return reply({ result: result ?? null });
    } catch (e: any) {
      return reply({ error: { code: typeof e?.code === 'number' ? e.code : -32603, message: String(e?.message ?? e) } });
    }
  }

  // ---------- HTTP and WebSocket ----------

  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('acp') ? 'acp' : false) });
  const sockets = new Set<Socket>();
  const server = http.createServer((_req, res) => { res.writeHead(404).end(); });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  /** Refuses a socket as core does: at the upgrade with an HTTP status (today), or by opening it and closing it with
   * a code a browser can read (refusals: 'close'). */
  const refuse = (req: http.IncomingMessage, socket: Socket, head: Buffer, status: 401 | 429, retrySeconds?: number) => {
    if (refusals === 'close') {
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(status === 401 ? 4401 : 4429, status === 401 ? 'key refused' : `retry in ${retrySeconds}`));
      return;
    }
    socket.write(`HTTP/1.1 ${status === 401 ? '401 Unauthorized' : '429 Too Many Requests'}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  server.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
    const bearer = protocols.find((p) => p.startsWith('bearer.'))?.slice('bearer.'.length);
    // The lockout: after `lockoutAfter` wrong keys in `lockoutMs`, every socket from here is refused (a good key too).
    const now = Date.now();
    while (badKeys.length && now - badKeys[0]! > lockoutMs) badKeys.shift();
    if (badKeys.length >= lockoutAfter) {
      lockedRefusals++;
      return refuse(req, socket as Socket, head, 429, Math.ceil((badKeys[0]! + lockoutMs - now) / 1000));
    }
    if (!req.url?.startsWith('/acp') || !keys.has(String(bearer))) {
      refusedUpgrades++;
      badKeys.push(now);
      return refuse(req, socket as Socket, head, 401);
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c: Conn = { id: ++connIds, ws, attached: new Set(), silent: false, nextId: 1, waiting: new Map() };
      conns.add(c);
      ws.on('message', (data) => { void handle(c, data.toString()); });
      ws.on('close', () => { conns.delete(c); });
      ws.on('error', () => {});
    });
  });

  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as { port: number }).port); });
  });
  const port = await listen(opts.port ?? 0);
  const stopListening = async () => {
    for (const c of conns) c.ws.terminate();
    conns.clear();
    await new Promise<void>((resolve) => { server.close(() => resolve()); for (const s of sockets) s.destroy(); });
  };

  return {
    url: `ws://127.0.0.1:${port}/acp`,
    port,
    key,
    threads,
    calls,
    unknown,
    errors,
    /** Requests and notifications received, optionally only one method's. */
    callsOf: (method: string) => calls.filter((x) => x.method === method),
    /** Waits until `method` has been received (and matches `match`), up to `timeoutMs`. */
    async waitForCall(method: string, match: (params: any) => boolean = () => true, timeoutMs = 10_000): Promise<Call> {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const hit = calls.find((x) => x.method === method && match(x.params));
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`fake server: no ${method} within ${timeoutMs} ms (got: ${calls.map((x) => x.method).join(', ')})`);
        await sleep(25);
      }
    },
    /** Open sockets right now. */
    get connections() { return conns.size; },
    /** Sockets refused for their key so far (the real server locks a key out after 5 in 15 minutes). */
    get refusedUpgrades() { return refusedUpgrades; },
    /** Sockets refused because this address was locked out. */
    get lockedRefusals() { return lockedRefusals; },
    /** Whether the lockout is on right now. */
    get locked() { const now = Date.now(); return badKeys.filter((t) => now - t <= lockoutMs).length >= lockoutAfter; },
    /** Locks this address out now, as if `lockoutAfter` wrong keys had just come. */
    lockOut() { const now = Date.now(); badKeys.length = 0; for (let i = 0; i < lockoutAfter; i++) badKeys.push(now); for (const c of conns) c.ws.terminate(); },
    /** Whether a turn is running in this thread. */
    running: (sessionId: string) => turns.has(sessionId),
    notifyAll,
    // ----- faults -----
    /** Every socket drops at once (as a network cut: no close frame). */
    dropAll() { for (const c of conns) c.ws.terminate(); },
    /** Stop listening for `ms` (sockets drop, new ones are refused), then come back on the same port. Threads and running turns survive. */
    async restart(ms: number) { await stopListening(); await sleep(ms); await listen(port); },
    /** Delay every reply by `ms` (0 to stop). */
    setDelay(ms: number) { faults.delayMs = ms; },
    /** Never answer `method` (requests are received and logged). */
    blackhole(method: string) { faults.blackhole.add(method); },
    /** Answer `method` with an error, `times` times (only calls whose params `match`, if given). */
    failNext(method: string, { times = 1, code = -32603, message = 'Internal error', match = () => true }: { times?: number; code?: number; message?: string; match?: (params: any) => boolean } = {}) {
      faults.fail.set(method, { times, code, message, match });
    },
    clearFaults() { faults.delayMs = 0; faults.blackhole.clear(); faults.fail.clear(); },
    /** Every open socket stays open but goes quiet both ways (a half-open connection). New connections work. */
    goSilent() { for (const c of conns) c.silent = true; },
    /** Answers the permission a thread waits on as if from another device. */
    answerElsewhere(sessionId: string, optionId = 'allow-once') { turns.get(sessionId)?.perm?.resolve(optionId, 'another device'); },
    /** Makes `n` extra finished threads in a project (for paging). */
    addThreads(project: string, n: number, title = (i: number) => `Old thread ${i}`) {
      const p = projects.get(project)!;
      for (let i = 1; i <= n; i++) {
        threads.set(`bulk-${project}-${i}`, { id: `bulk-${project}-${i}`, title: title(i), project, projectName: p.name, cwd: p.cwd, kind: 'work', updatedAt: iso(1000 + i),
          status: 'idle', pinned: false, archived: false, history: [], modeId: 'default', provider: null, plan: null, cards: [] });
      }
    },
    /** The device key stops working (a new one, if given, works instead): open sockets drop, and new ones with the old key are refused (401) while the server stays up. */
    revokeKey(replacement?: string) { keys.clear(); if (replacement) keys.add(replacement); for (const c of conns) c.ws.terminate(); },
    async close() { await stopListening(); wss.close(); },
  };
}
