// First-run setup (docs/setup-guide.md): the checklist's state. Saved on this device so setup can be closed and picked
// up again. It holds choices and addresses only, never a key and never what was said to the guide.
import { useSyncExternalStore } from 'react';
import { ClientApp, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';

export type Step = 'key' | 'server' | 'connect' | 'provider' | 'import' | 'done';
export const STEPS: { id: Exclude<Step, 'key'> | 'key'; label: string }[] = [
  { id: 'key', label: 'Model key' },
  { id: 'server', label: 'Server' },
  { id: 'connect', label: 'Connect' },
  { id: 'provider', label: 'Model on the server' },
  // The app's import view, opened by App with the guide beside it (docs/import.md).
  { id: 'import', label: 'Bring everything from Claude' },
  { id: 'done', label: 'Done' },
];
/** Where the server will run: this computer, another computer the person owns, or an address they were given. */
export type Where = 'here' | 'other' | 'given';
export type ProviderKind = 'anthropic' | 'openai';

export interface GuideModel { kind: ProviderKind; baseUrl: string; model: string; models: string[]; local?: boolean }

export interface SetupState {
  v: 1;
  /** True from the first launch until setup is finished or skipped. */
  active: boolean;
  step: Step;
  /** The guide's model, or null when setting up without help. */
  guide: GuideModel | null;
  where?: Where;
  /** The server's ACP address once it answered the health check (ws:// or wss://). */
  address?: string;
  serverId?: string;
  /** Last result of each check, in words, for the guide and for the step itself. */
  notes?: Partial<Record<'address' | 'connect' | 'provider' | 'docker' | 'import', string>>;
}

const KEY = 'hearth.setup.v1';
const fresh = (): SetupState => ({ v: 1, active: true, step: 'key', guide: null });

function load(): SetupState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.v === 1 && typeof s.step === 'string' ? s : null;
  } catch { return null; }
}

let state: SetupState | null = load();
const listeners = new Set<() => void>();
function save() {
  try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  for (const l of listeners) l();
}

export function useSetup(): SetupState | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
export const setupState = () => state;

/** Starts setup from the beginning (first launch, or every server was removed). */
export function startSetup() { state = fresh(); save(); }
export function updateSetup(change: Partial<SetupState> | ((s: SetupState) => Partial<SetupState>)) {
  const cur = state ?? fresh();
  state = { ...cur, ...(typeof change === 'function' ? change(cur) : change) };
  save();
}
export function noteSetup(which: keyof NonNullable<SetupState['notes']>, text: string | undefined) {
  updateSetup((s) => ({ notes: { ...s.notes, [which]: text } }));
}
/** Setup is over: the app opens normally from now on. */
export function finishSetup() { updateSetup({ active: false, step: 'done' }); }

/** The next step after this one, in checklist order. */
export function nextStep(s: Step): Step {
  const i = STEPS.findIndex((x) => x.id === s);
  return STEPS[Math.min(i + 1, STEPS.length - 1)].id;
}
export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

/** One request to a server over ACP (initialize first), then close. Used by the checklist and the guide's tools. */
export async function serverCall<T>(url: string, key: string, method?: string, params?: unknown): Promise<{ agent: string; extensions: string[]; result?: T }> {
  const conn = new ClientApp({ name: 'hearth-setup' }).connect(createWebSocketStream(url, { protocols: ['acp', `bearer.${key}`] }));
  const timeout = <X,>(p: Promise<X>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('No answer from the server.')), 8000))]);
  try {
    const init: any = await timeout(conn.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'hearth', version: '0.1.0' } }));
    const extensions: string[] = Array.isArray(init?._meta?.hearth?.extensions) ? init._meta.hearth.extensions : [];
    const agent = String(init?.agentInfo?.title ?? init?.agentInfo?.name ?? 'ACP server');
    if (!method) return { agent, extensions };
    const result = await timeout(conn.agent.request(method as any, (params ?? {}) as any)) as T;
    return { agent, extensions, result };
  } finally { try { conn.close(); } catch { /* */ } }
}

export interface ServerProvider { name: string; kind: string; enabled: boolean; status: 'ok' | 'down' | 'off'; last_error: string | null }
/** The server's providers in words: does it have a model that works? */
export function providerVerdict(rows: ServerProvider[] | null): { ok: boolean; text: string } {
  if (rows === null) return { ok: true, text: "This server doesn't say which models it uses. That's fine: carry on." };
  const on = rows.filter((r) => r.enabled);
  const up = on.filter((r) => r.status === 'ok');
  if (up.length) return { ok: true, text: `Your server has a working model provider (${up.map((r) => r.name).join(', ')}).` };
  if (on.length) return { ok: false, text: `Your server has a model provider (${on.map((r) => r.name).join(', ')}), but it isn't working: ${on[0].last_error ?? 'no answer'}.` };
  return { ok: false, text: 'Your server has no model provider yet, so its chats would wait.' };
}
