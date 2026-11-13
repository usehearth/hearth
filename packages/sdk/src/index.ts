// @hearth/sdk: a small typed client for a Hearth server (ACP over WebSocket).
// Works in Node >= 22 (global WebSocket) and in browsers. One WebSocket per `Hearth`; threads share it.
import { ClientApp, PROTOCOL_VERSION, RequestError, type ClientConnection } from '@agentclientprotocol/sdk';
import { createWebSocketStream, type WebSocketConstructor } from '@agentclientprotocol/sdk/experimental/ws-client';

export { PROTOCOL_VERSION };

export interface ConnectOptions {
  /** ws:// or wss:// address of the server's ACP endpoint, e.g. wss://ai.example/acp */
  url: string;
  /** Device key; sent as the `bearer.<key>` WebSocket subprotocol (with `acp`). */
  key: string;
  /** Name sent as `clientInfo.name` (default `hearth-sdk`). */
  clientName?: string;
  /** Version sent as `clientInfo.version` (default this SDK's version). */
  clientVersion?: string;
  /** WebSocket constructor; defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketConstructor;
}

export interface AgentInfo { name: string; title?: string; version?: string; [k: string]: unknown }

export interface ThreadInfo {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: string | null;
  project: string;
  projectName: string;
  /** `main` or `work` (or whatever the server sends). */
  kind: string;
  status: string | null;
  archived: boolean;
  pinned: boolean;
  /** The server's entry as received. */
  raw: Record<string, unknown>;
}

export interface SearchResult {
  sessionId: string;
  project: string;
  title: string;
  updatedAt?: string | null;
  /** Matching text around the hit, when the match is in the content. */
  snippet?: string | null;
  [k: string]: unknown;
}

export interface Message { role: 'user' | 'assistant'; text: string }

/** A `session/update` payload (`params.update`). */
export interface SessionUpdate { sessionUpdate: string; [k: string]: unknown }

export interface PermissionOption { optionId: string; name: string; kind: string; [k: string]: unknown }
export interface PermissionRequest {
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: PermissionOption[];
  [k: string]: unknown;
}

export interface SendOptions {
  /** Each `agent_message_chunk` text as it streams. */
  onText?: (text: string) => void;
  /** Every `session/update` of this thread during the turn. */
  onUpdate?: (update: SessionUpdate) => void;
  /**
   * Answers `session/request_permission`: return an `optionId` to select it; anything else
   * (or no handler) answers `cancelled`.
   */
  onPermission?: (req: PermissionRequest) => string | null | undefined | Promise<string | null | undefined>;
}

export interface SendResult { stopReason: string; text: string }

export type Mode = 'default' | 'acceptEdits' | 'plan' | (string & {});

const SDK_VERSION = '0.1.0';
const MAX_PAGES = 100;

interface ThreadSink {
  update(u: SessionUpdate): void;
  permission(req: PermissionRequest): Promise<string | null | undefined>;
}

function toThreadInfo(s: any): ThreadInfo {
  const h = s?._meta?.hearth ?? {};
  const cwd = String(s?.cwd ?? '');
  return {
    sessionId: String(s?.sessionId),
    title: String(s?.title ?? 'Untitled'),
    cwd,
    updatedAt: s?.updatedAt ?? null,
    project: String(h.project ?? cwd),
    projectName: String(h.projectName ?? h.project ?? cwd),
    kind: String(h.kind ?? 'work'),
    status: h.status ?? null,
    archived: !!h.archived,
    pinned: !!h.pinned,
    raw: s ?? {},
  };
}

/** Text of an update's `content` (a single block or an array of blocks). */
function contentText(content: unknown): string {
  if (Array.isArray(content)) return content.map(contentText).join('');
  const c = content as { type?: string; text?: unknown } | undefined;
  return c && c.type === 'text' && typeof c.text === 'string' ? c.text : '';
}

export class Thread {
  /** Messages replayed by `openThread` (empty for a new thread); `send` appends to it. */
  readonly messages: Message[];
  /** `_meta.hearth` of the session/new or session/load answer. */
  readonly meta: Record<string, unknown>;
  /** Modes the server reported for this session, if any. */
  readonly modes: { currentModeId?: string; availableModes?: { id: string; name: string; description?: string }[] } | undefined;
  private turn: SendOptions & { text: string } | null = null;

  /** @internal */
  constructor(private readonly hearth: Hearth, readonly sessionId: string, init: { messages?: Message[]; meta?: any; modes?: any }) {
    this.messages = init.messages ?? [];
    this.meta = init.meta ?? {};
    this.modes = init.modes;
  }

  /** @internal */
  readonly sink: ThreadSink = {
    update: (u) => {
      const t = this.turn;
      if (!t) return;
      if (u.sessionUpdate === 'agent_message_chunk') {
        const s = contentText(u.content);
        if (s) { t.text += s; t.onText?.(s); }
      }
      t.onUpdate?.(u);
    },
    permission: async (req) => (this.turn?.onPermission ? this.turn.onPermission(req) : undefined),
  };

  /** Sends one prompt and waits for the turn to end. Resolves with the stop reason and the streamed answer text. */
  async send(text: string, opts: SendOptions = {}): Promise<SendResult> {
    if (this.turn) throw new Error('A turn is already running on this thread.');
    const turn = (this.turn = { ...opts, text: '' });
    try {
      const r = await this.hearth.request<{ stopReason?: string }>('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }],
      });
      this.messages.push({ role: 'user', text }, { role: 'assistant', text: turn.text });
      return { stopReason: String(r?.stopReason ?? 'end_turn'), text: turn.text };
    } finally {
      this.turn = null;
    }
  }

  /** Asks the server to stop the running turn (`session/cancel`). */
  async cancel(): Promise<void> {
    await this.hearth.notify('session/cancel', { sessionId: this.sessionId });
  }

  /** `session/set_mode`: `default`, `acceptEdits` or `plan`. */
  async setMode(mode: Mode): Promise<void> {
    await this.hearth.request('session/set_mode', { sessionId: this.sessionId, modeId: mode });
  }
}

export class Hearth {
  /** `_hearth/*` extensions the server announced in `initialize` (`_meta.hearth.extensions`). */
  readonly extensions: string[];
  readonly agentInfo: AgentInfo | undefined;
  /** The full `initialize` result. */
  readonly initializeResult: Record<string, any>;
  /** Resolves when the connection closes. */
  readonly closed: Promise<void>;
  private readonly sinks: Map<string, ThreadSink>;

  /** @internal */
  constructor(private readonly conn: ClientConnection, init: Record<string, any>, sinks: Map<string, ThreadSink>) {
    this.initializeResult = init;
    this.agentInfo = init?.agentInfo;
    this.extensions = Array.isArray(init?._meta?.hearth?.extensions) ? init._meta.hearth.extensions.map(String) : [];
    this.closed = conn.closed;
    this.sinks = sinks;
  }

  /** Any request on the connection: `_hearth/*` extension methods, or plain ACP methods. */
  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return this.conn.agent.request<T>(method, params);
  }

  /** A notification on the connection. */
  notify(method: string, params: unknown = {}): Promise<void> {
    return this.conn.agent.notify(method, params);
  }

  /** Every thread (all pages of `session/list`). */
  async threads(opts: { archived?: boolean } = {}): Promise<ThreadInfo[]> {
    const out: ThreadInfo[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < MAX_PAGES; n++) {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;
      if (opts.archived !== undefined) params._meta = { hearth: { archived: opts.archived } };
      const r = await this.request<any>('session/list', params);
      out.push(...((r?.sessions ?? []) as any[]).map(toThreadInfo));
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  /** `_hearth/threads/search`: threads whose title or content match. */
  async search(query: string): Promise<SearchResult[]> {
    const r = await this.request<{ results?: SearchResult[] }>('_hearth/threads/search', { query });
    return Array.isArray(r?.results) ? r.results : [];
  }

  /** Starts a new thread in a project (`session/new`). `cwd` defaults to the project's folder as the list shows it. */
  async newThread(opts: { project: string; title?: string; cwd?: string; main?: boolean }): Promise<Thread> {
    let cwd = opts.cwd;
    if (cwd === undefined) {
      const known = (await this.threads().catch(() => [] as ThreadInfo[])).find((t) => t.project === opts.project && t.cwd);
      cwd = known?.cwd ?? '';
    }
    const hearth: Record<string, unknown> = { project: opts.project };
    if (opts.title !== undefined) hearth.title = opts.title;
    if (opts.main !== undefined) hearth.main = opts.main;
    const r = await this.request<any>('session/new', { cwd, mcpServers: [], _meta: { hearth } });
    const thread = new Thread(this, String(r.sessionId), { meta: r?._meta?.hearth, modes: r?.modes });
    this.sinks.set(thread.sessionId, thread.sink);
    return thread;
  }

  /** Opens an existing thread (`session/load`) and collects its replayed history into `thread.messages`. */
  async openThread(sessionId: string, opts: { cwd?: string } = {}): Promise<Thread> {
    let cwd = opts.cwd;
    if (cwd === undefined) {
      const all = await this.threads().catch(() => [] as ThreadInfo[]);
      const archived = all.some((t) => t.sessionId === sessionId) ? [] : await this.threads({ archived: true }).catch(() => [] as ThreadInfo[]);
      cwd = [...all, ...archived].find((t) => t.sessionId === sessionId)?.cwd ?? '';
    }
    const messages: Message[] = [];
    const collect: ThreadSink = {
      update: (u) => {
        const role = u.sessionUpdate === 'user_message_chunk' ? 'user' : u.sessionUpdate === 'agent_message_chunk' ? 'assistant' : null;
        if (!role) return;
        const text = contentText(u.content);
        const last = messages[messages.length - 1];
        if (last && last.role === role) last.text += text;
        else messages.push({ role, text });
      },
      permission: async () => undefined,
    };
    this.sinks.set(sessionId, collect);
    try {
      const r = await this.request<any>('session/load', { sessionId, cwd, mcpServers: [] });
      const thread = new Thread(this, sessionId, { messages, meta: r?._meta?.hearth, modes: r?.modes });
      this.sinks.set(sessionId, thread.sink);
      return thread;
    } catch (e) {
      if (this.sinks.get(sessionId) === collect) this.sinks.delete(sessionId);
      throw e;
    }
  }

  /** Closes the connection. */
  close(): void {
    try { this.conn.close(); } catch { /* already closed */ }
  }
}

/** Opens a connection and runs `initialize`. */
export async function connect(opts: ConnectOptions): Promise<Hearth> {
  if (!opts.url) throw new Error('connect: url is required');
  if (!opts.key) throw new Error('connect: key is required');
  const sinks = new Map<string, ThreadSink>();
  const app = new ClientApp({ name: opts.clientName ?? 'hearth-sdk' })
    .onNotification('*', (ctx) => {
      if (ctx.method !== 'session/update') return;
      const p = ctx.params as { sessionId?: string; update?: SessionUpdate } | undefined;
      if (p?.sessionId && p.update) sinks.get(p.sessionId)?.update(p.update);
    })
    .onRequest('*', async (ctx) => {
      if (ctx.method !== 'session/request_permission') throw RequestError.methodNotFound(ctx.method);
      const req = ctx.params as PermissionRequest;
      let optionId: string | null | undefined;
      try { optionId = await sinks.get(req?.sessionId)?.permission(req); } catch { optionId = undefined; }
      const valid = typeof optionId === 'string' && (req?.options ?? []).some((o) => o.optionId === optionId);
      return valid ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } };
    });
  const stream = createWebSocketStream(opts.url, {
    protocols: ['acp', `bearer.${opts.key}`],
    ...(opts.WebSocket ? { WebSocket: opts.WebSocket } : {}),
  });
  const conn = app.connect(stream);
  try {
    const init = await conn.agent.request<Record<string, any>>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: opts.clientName ?? 'hearth-sdk', version: opts.clientVersion ?? SDK_VERSION },
    });
    return new Hearth(conn, init, sinks);
  } catch (e) {
    try { conn.close(); } catch { /* */ }
    throw friendlyError(e);
  }
}

function friendlyError(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(typeof e === 'object' && e && 'message' in e ? String((e as any).message) : String(e));
  if (/closed|1006|ECONNREFUSED|Event/i.test(err.message) || (typeof Event !== 'undefined' && e instanceof Event)) {
    return new Error("Can't reach the server, or it refused the key.", { cause: e });
  }
  return err;
}
