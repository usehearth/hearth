import type {
  CompleteAttachment,
  MessageStatus,
  ThreadAssistantMessage,
  ThreadUserMessagePart,
  ToolApprovalOption,
} from "@assistant-ui/core";
import { isRecord } from "@assistant-ui/core/internal";
import type {
  AcpAgentCapabilities,
  AcpAvailableCommand,
  AcpConnectionState,
  AcpImplementation,
  AcpPermissionRequest,
  AcpPlanEntry,
  AcpSessionConfigOption,
  AcpSessionModeState,
  AcpSessionUpdate,
  AcpUsage,
} from "./types";
import {
  appendContentBlock,
  applyToolCallUpdate,
  attachToolCallApproval,
  permissionOptionToApprovalOption,
  resolveToolCallApproval,
} from "./conversions";

type AssistantPart = ThreadAssistantMessage["content"][number];

export type AcpLoadState =
  | { readonly type: "idle" }
  | { readonly type: "loading" }
  | { readonly type: "ready" };

export type AcpRunState =
  | { readonly type: "idle" }
  | { readonly type: "running"; readonly assistantId: string };

export type AcpUserMessage = {
  readonly role: "user";
  readonly id: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly content: readonly ThreadUserMessagePart[];
  readonly attachments: readonly CompleteAttachment[];
};

export type AcpAssistantMessage = {
  readonly role: "assistant";
  readonly id: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly status: MessageStatus;
  readonly content: readonly AssistantPart[];
};

export type AcpThreadMessage = AcpUserMessage | AcpAssistantMessage;

export type AcpPendingPermission = {
  readonly approvalId: string;
  readonly assistantId: string;
  readonly toolCallId: string;
  readonly options: readonly ToolApprovalOption[];
};

export type AcpThreadState = {
  /** Identifies the thread; a new thread gets a new id. */
  readonly threadId: string;
  readonly loadState: AcpLoadState;
  readonly connectionState: AcpConnectionState;
  readonly sessionId: string | undefined;
  readonly agentInfo: AcpImplementation | undefined;
  readonly agentCapabilities: AcpAgentCapabilities | undefined;
  readonly messageOrder: readonly string[];
  readonly messagesById: Readonly<Record<string, AcpThreadMessage>>;
  readonly headId: string | null;
  readonly run: AcpRunState;
  /**
   * A cancelled turn whose `session/prompt` has not settled yet. The agent may
   * still report its tool calls, and they land on this message.
   */
  readonly settlingAssistantId: string | undefined;
  readonly permissions: Readonly<Record<string, AcpPendingPermission>>;
  readonly plan: readonly AcpPlanEntry[] | undefined;
  readonly sessionTitle: string | undefined;
  readonly currentModeId: string | undefined;
  readonly availableCommands: readonly AcpAvailableCommand[] | undefined;
  readonly configOptions: readonly AcpSessionConfigOption[] | undefined;
  readonly usage: AcpUsage | undefined;
  /** Hearth: where updates outside this window's own turn land (history, other windows). */
  readonly passiveAssistantId?: string | undefined;
  /** Hearth: the last message is a user message still receiving chunks. */
  readonly passiveUserOpen?: boolean | undefined;
};

export type AcpThreadEvent =
  | { readonly type: "load-start" }
  | { readonly type: "load-ready" }
  | {
      readonly type: "connection";
      readonly connectionState: AcpConnectionState;
      readonly sessionId: string | undefined;
      readonly agentInfo?: AcpImplementation | undefined;
      readonly agentCapabilities?: AcpAgentCapabilities | undefined;
      readonly sessionModes?: AcpSessionModeState | undefined;
      readonly sessionConfigOptions?:
        | readonly AcpSessionConfigOption[]
        | undefined;
    }
  | { readonly type: "append-message"; readonly message: AcpThreadMessage }
  | { readonly type: "run-start"; readonly message: AcpAssistantMessage }
  | { readonly type: "session-update"; readonly update: AcpSessionUpdate }
  | {
      readonly type: "permission-request";
      readonly approvalId: string;
      readonly request: AcpPermissionRequest;
    }
  | {
      readonly type: "permission-resolved";
      readonly approvalId: string;
      readonly approved: boolean;
      readonly optionId?: string | undefined;
      readonly cancelled: boolean;
    }
  | { readonly type: "permissions-cancelled" }
  | {
      readonly type: "run-end";
      readonly assistantId: string;
      readonly status: MessageStatus;
      readonly settling?: boolean | undefined;
    }
  | { readonly type: "run-settled"; readonly assistantId: string }
  | { readonly type: "reset"; readonly threadId: string };

export const EMPTY_ACP_THREAD_STATE: AcpThreadState = {
  threadId: "acp-thread",
  loadState: { type: "idle" },
  connectionState: "disconnected",
  sessionId: undefined,
  agentInfo: undefined,
  agentCapabilities: undefined,
  messageOrder: [],
  messagesById: {},
  headId: null,
  run: { type: "idle" },
  settlingAssistantId: undefined,
  permissions: {},
  plan: undefined,
  sessionTitle: undefined,
  currentModeId: undefined,
  availableCommands: undefined,
  configOptions: undefined,
  usage: undefined,
};

export const createAcpThreadState = (): AcpThreadState =>
  EMPTY_ACP_THREAD_STATE;

export const isAcpStateRunning = (state: AcpThreadState): boolean =>
  state.run.type === "running";

const RUNNING_STATUS: MessageStatus = { type: "running" };

const runningId = (state: AcpThreadState): string | undefined =>
  state.run.type === "running" ? state.run.assistantId : undefined;

const withMessage = (
  state: AcpThreadState,
  message: AcpThreadMessage,
): AcpThreadState => ({
  ...state,
  messageOrder: state.messagesById[message.id]
    ? state.messageOrder
    : [...state.messageOrder, message.id],
  messagesById: { ...state.messagesById, [message.id]: message },
  headId: message.id,
});

const patchAssistant = (
  state: AcpThreadState,
  assistantId: string | undefined,
  patch: (message: AcpAssistantMessage) => AcpAssistantMessage,
): AcpThreadState => {
  if (assistantId === undefined) return state;
  const message = state.messagesById[assistantId];
  if (message?.role !== "assistant") return state;
  const next = patch(message);
  if (next === message) return state;
  return {
    ...state,
    messagesById: { ...state.messagesById, [assistantId]: next },
  };
};

const resolveApproval = (
  message: AcpAssistantMessage,
  approvalId: string,
  resolution: Parameters<typeof resolveToolCallApproval>[2],
  stillWaiting: boolean,
): AcpAssistantMessage => {
  const content = resolveToolCallApproval(
    message.content,
    approvalId,
    resolution,
  );
  const resumes = !stillWaiting && message.status.type === "requires-action";
  if (!content && !resumes) return message;
  return {
    ...message,
    ...(content && { content }),
    ...(resumes && { status: RUNNING_STATUS }),
  };
};

const cancelPermissions = (state: AcpThreadState): AcpThreadState => {
  const pending = Object.values(state.permissions);
  if (pending.length === 0) return state;
  let next: AcpThreadState = { ...state, permissions: {} };
  for (const permission of pending) {
    next = patchAssistant(next, permission.assistantId, (message) =>
      resolveApproval(
        message,
        permission.approvalId,
        { resolution: "cancelled" },
        false,
      ),
    );
  }
  return next;
};

/** Hearth: `<context ref="file:///name">text</context>` blocks (embedded files) out of a user message's text. */
const CONTEXT_BLOCK = /\n?<context ref="([^"]*)">\n([\s\S]*?)\n<\/context>/g;
let contextIds = 0;
export const splitContext = (text: string): { text: string; files: CompleteAttachment[] } => {
  if (!text.includes("<context ref=")) return { text, files: [] };
  const files: CompleteAttachment[] = [];
  const rest = text.replace(CONTEXT_BLOCK, (_m, ref: string, body: string) => {
    let name = ref;
    try { name = decodeURIComponent(ref.replace(/^file:\/\/\/?/, "")) || ref; } catch { /* keep the ref */ }
    files.push({
      id: `ctx-${contextIds++}`,
      type: "document",
      name,
      contentType: "text/plain",
      status: { type: "complete" },
      content: [{ type: "text", text: body }],
    });
    return "";
  });
  return { text: rest.trim(), files };
};

/** Hearth: `[attached: <path>]` lines (files the server saved into the project folder) out of a user message's text. */
const ATTACHED_LINE = /\n?\[attached: ([^\]\n]+)\]/g;
export const splitAttached = (text: string): { text: string; files: CompleteAttachment[] } => {
  if (!text.includes("[attached: ")) return { text, files: [] };
  const files: CompleteAttachment[] = [];
  const rest = text.replace(ATTACHED_LINE, (_m, path: string) => {
    const file = path.split("/").pop() ?? path;
    files.push({
      id: `att-${contextIds++}`,
      type: "document",
      name: file.replace(/^\d{8}-\d{6}-/, ""),
      contentType: "application/octet-stream",
      status: { type: "complete" },
      content: [{ type: "text", text: `Saved in the project folder: ${path}` }],
    });
    return "";
  });
  return { text: rest.trim(), files };
};

/**
 * Hearth: the server owns the thread, so a replay (`session/load`) and turns
 * started in other windows arrive while this window runs no turn of its own.
 * Build user and assistant messages from them instead of dropping them.
 * Returns undefined for updates the normal path handles (plan, title...).
 */
const reducePassive = (
  state: AcpThreadState,
  update: AcpSessionUpdate,
): AcpThreadState | undefined => {
  const u = update as any;
  switch (u.sessionUpdate) {
    case "user_message_chunk": {
      const block = u.content;
      // Hearth: files sent as embedded text come back inside the text as <context> blocks; show them as file chips.
      const ctx = block?.type === "text" ? splitContext(String(block.text ?? "")) : undefined;
      const att = ctx ? splitAttached(ctx.text) : undefined;
      const split = ctx && att ? { text: att.text, files: [...ctx.files, ...att.files] } : undefined;
      const part: ThreadUserMessagePart | undefined =
        split
          ? split.text ? { type: "text", text: split.text } : undefined
          : block?.type === "image" && block.data
            ? { type: "image", image: `data:${block.mimeType};base64,${block.data}` }
            : undefined;
      const files = split?.files ?? [];
      if (!part && !files.length) return state;
      const head = state.headId ? state.messagesById[state.headId] : undefined;
      if (!part && state.passiveUserOpen && head?.role === "user") {
        return { ...state, messagesById: { ...state.messagesById, [head.id]: { ...head, attachments: [...head.attachments, ...files] } } };
      }
      if (!part) return state;
      if (state.passiveUserOpen && head?.role === "user") {
        const last = head.content[head.content.length - 1];
        const content =
          part.type === "text" && last?.type === "text"
            ? [...head.content.slice(0, -1), { type: "text" as const, text: last.text + part.text }]
            : [...head.content, part];
        return { ...state, messagesById: { ...state.messagesById, [head.id]: { ...head, content, attachments: [...head.attachments, ...files] } } };
      }
      const message: AcpUserMessage = {
        role: "user",
        id: `p-u-${state.messageOrder.length}`,
        parentId: state.headId,
        createdAt: Date.now(),
        content: [part],
        attachments: files,
      };
      return { ...withMessage(state, message), passiveUserOpen: true, passiveAssistantId: undefined };
    }
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "tool_call_update": {
      let next = state;
      let id = state.passiveAssistantId;
      if (id === undefined || !state.messagesById[id]) {
        const message: AcpAssistantMessage = {
          role: "assistant",
          id: `p-a-${state.messageOrder.length}`,
          parentId: state.headId,
          createdAt: Date.now(),
          status: { type: "complete", reason: "unknown" },
          content: [],
        };
        next = withMessage(state, message);
        id = message.id;
      }
      next = { ...next, passiveAssistantId: id, passiveUserOpen: false };
      if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
        if (typeof u.toolCallId !== "string") return next;
        return patchAssistant(next, id, (message) => {
          const content = applyToolCallUpdate(message.content, u);
          return content ? { ...message, content } : message;
        });
      }
      const kind = u.sessionUpdate === "agent_message_chunk" ? "text" : "reasoning";
      return patchAssistant(next, id, (message) => {
        const content = appendContentBlock(message.content, u.content, kind);
        return content ? { ...message, content } : message;
      });
    }
    default:
      return undefined;
  }
};

const reduceSessionUpdate = (
  state: AcpThreadState,
  update: AcpSessionUpdate,
): AcpThreadState => {
  // Hearth: a card (`_meta.hearth.card`) is drawn as a card by the app, not as message text.
  if ((update as any)?._meta?.hearth?.card) return state;
  if (state.settlingAssistantId === undefined && runningId(state) === undefined) {
    const passive = reducePassive(state, update);
    if (passive) return passive;
  }
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      if (state.settlingAssistantId !== undefined) return state;
      const kind =
        update.sessionUpdate === "agent_message_chunk" ? "text" : "reasoning";
      return patchAssistant(state, runningId(state), (message) => {
        const content = appendContentBlock(
          message.content,
          update.content,
          kind,
        );
        return content ? { ...message, content } : message;
      });
    }
    case "tool_call":
    case "tool_call_update": {
      if (typeof update.toolCallId !== "string") return state;
      return patchAssistant(
        state,
        state.settlingAssistantId ?? runningId(state),
        (message) => {
          const content = applyToolCallUpdate(message.content, update);
          return content ? { ...message, content } : message;
        },
      );
    }
    case "plan":
      return state.plan === update.entries
        ? state
        : { ...state, plan: update.entries };
    case "session_info_update": {
      if (update.title === undefined) return state;
      const title = update.title ?? undefined;
      return state.sessionTitle === title
        ? state
        : { ...state, sessionTitle: title };
    }
    case "current_mode_update":
      return state.currentModeId === update.currentModeId
        ? state
        : { ...state, currentModeId: update.currentModeId };
    case "available_commands_update":
      return state.availableCommands === update.availableCommands
        ? state
        : { ...state, availableCommands: update.availableCommands };
    case "config_option_update":
      return state.configOptions === update.configOptions
        ? state
        : { ...state, configOptions: update.configOptions };
    case "usage_update":
      return {
        ...state,
        usage: {
          used: update.used,
          size: update.size,
          cost: update.cost ?? null,
        },
      };
    default:
      return state;
  }
};

export const reduceAcpThreadState = (
  state: AcpThreadState,
  event: AcpThreadEvent,
): AcpThreadState => {
  switch (event.type) {
    case "load-start":
      return state.loadState.type === "loading"
        ? state
        : { ...state, loadState: { type: "loading" } };

    case "load-ready":
      return state.loadState.type === "loading"
        ? { ...state, loadState: { type: "ready" } }
        : state;

    case "connection": {
      const sessionOpened =
        event.sessionId !== undefined && event.sessionId !== state.sessionId;
      return {
        ...state,
        connectionState: event.connectionState,
        sessionId: event.sessionId,
        ...(event.agentInfo !== undefined && { agentInfo: event.agentInfo }),
        ...(event.agentCapabilities !== undefined && {
          agentCapabilities: event.agentCapabilities,
        }),
        ...(sessionOpened && {
          currentModeId: event.sessionModes?.currentModeId,
          configOptions: event.sessionConfigOptions,
        }),
      };
    }

    case "append-message":
      return { ...withMessage(state, event.message), passiveAssistantId: undefined, passiveUserOpen: false };

    case "run-start":
      return {
        ...withMessage(state, event.message),
        run: { type: "running", assistantId: event.message.id },
        passiveAssistantId: undefined,
        passiveUserOpen: false,
      };

    case "session-update":
      return isRecord(event.update)
        ? reduceSessionUpdate(state, event.update)
        : state;

    case "permission-request": {
      const assistantId = runningId(state);
      if (assistantId === undefined) return state;
      const { toolCall, options } = event.request;
      const approval = {
        id: event.approvalId,
        options: options.map(permissionOptionToApprovalOption),
      };
      const next = patchAssistant(state, assistantId, (message) => ({
        ...message,
        status: { type: "requires-action", reason: "tool-calls" },
        content: attachToolCallApproval(message.content, toolCall, approval),
      }));
      return {
        ...next,
        permissions: {
          ...next.permissions,
          [event.approvalId]: {
            approvalId: event.approvalId,
            assistantId,
            toolCallId: toolCall.toolCallId,
            options: approval.options,
          },
        },
      };
    }

    case "permission-resolved": {
      const permission = state.permissions[event.approvalId];
      if (!permission) return state;
      const { [event.approvalId]: _resolved, ...permissions } =
        state.permissions;
      const stillWaiting = Object.values(permissions).some(
        (other) => other.assistantId === permission.assistantId,
      );
      const next = patchAssistant(state, permission.assistantId, (message) =>
        resolveApproval(
          message,
          event.approvalId,
          {
            approved: event.approved,
            ...(event.optionId !== undefined && { optionId: event.optionId }),
            ...(event.cancelled && { resolution: "cancelled" as const }),
          },
          stillWaiting,
        ),
      );
      return { ...next, permissions };
    }

    case "permissions-cancelled":
      return cancelPermissions(state);

    case "run-end": {
      if (runningId(state) !== event.assistantId) return state;
      const next = patchAssistant(
        cancelPermissions(state),
        event.assistantId,
        (message) => ({ ...message, status: event.status }),
      );
      return {
        ...next,
        run: { type: "idle" },
        ...(event.settling && { settlingAssistantId: event.assistantId }),
      };
    }

    case "run-settled":
      return state.settlingAssistantId === event.assistantId
        ? { ...state, settlingAssistantId: undefined }
        : state;

    case "reset":
      return {
        ...EMPTY_ACP_THREAD_STATE,
        threadId: event.threadId,
        loadState: state.loadState,
        connectionState: state.connectionState,
        agentInfo: state.agentInfo,
        agentCapabilities: state.agentCapabilities,
      };

    default:
      return state;
  }
};
