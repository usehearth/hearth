// The setup guide's brain (docs/setup-guide.md): the provider formats, key detection, the tools and the turn loop.
// The model call itself runs in the desktop shell (src-tauri/src/guide.rs), which holds the key. Everything here is
// plain functions with the shell passed in, so it can be tested without a window or a provider.
import type { GuideModel, ProviderKind, SetupState } from './setup';

// ---------- keys never reach the model ----------

/** Known key shapes, plus any long token mixing upper case, lower case and digits (no spaces, no slashes). */
const KEY_RES = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:or-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
];
const LONG_TOKEN = /[A-Za-z0-9_\-+=.]{32,}/g;
const looksSecret = (t: string) => /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t) && !/^[\d.]+$/.test(t);

/** Key-shaped strings in a piece of text. */
export function findKeys(text: string): string[] {
  const found = new Set<string>();
  for (const re of KEY_RES) for (const m of text.matchAll(re)) found.add(m[0]);
  for (const m of text.matchAll(LONG_TOKEN)) if (looksSecret(m[0])) found.add(m[0]);
  return [...found];
}
export const KEY_MARK = '‹key›';
/** Replaces anything key-shaped with ‹key›: tool results pass through this before the model sees them. */
export function scrub(text: string): string {
  let out = text;
  for (const k of findKeys(text).sort((a, b) => b.length - a.length)) out = out.split(k).join(KEY_MARK);
  return out;
}

// ---------- the guide's model ----------

/** A fast, cheap model for the guide: Haiku 5.5 for Claude, else the first small-sounding model the endpoint lists. */
export function pickModel(kind: ProviderKind, ids: string[]): string {
  if (kind === 'anthropic') {
    return ids.find((i) => i === 'claude-haiku-5-5') ?? ids.find((i) => /haiku/.test(i)) ?? ids.find((i) => /sonnet/.test(i)) ?? ids[0];
  }
  return ids.find((i) => /(mini|flash|haiku|small|lite|8b|7b)/i.test(i) && !/(embed|whisper|tts|dall|image|audio|moderation)/i.test(i))
    ?? ids.find((i) => !/(embed|whisper|tts|dall|image|audio|moderation)/i.test(i)) ?? ids[0];
}

export const GET_KEY_LINKS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
  ollama: 'https://ollama.com/download',
};

// ---------- provider formats ----------

export interface ToolDef { name: string; description: string; schema: Record<string, unknown> }
export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
export interface Parsed {
  text: string;
  calls: ToolCall[];
  stop: 'end' | 'tool' | 'refusal' | 'length' | 'other';
  usage: { input: number; output: number };
}
/** The conversation in the provider's own format: assistant turns go back exactly as they came. */
export type History = unknown[];

export interface Adapter {
  body(model: string, system: string, history: History, tools: ToolDef[]): Record<string, unknown>;
  parse(resp: any): Parsed;
  assistant(resp: any): unknown;
  user(text: string): unknown[];
  results(rs: { id: string; content: string; error?: boolean }[]): unknown[];
}

// Current Claude models take an effort level; a setup chat needs little thinking.
const takesEffort = (model: string) => /^claude-(haiku|sonnet|opus)-5|^claude-(fable|mythos)-/.test(model);

export const anthropic: Adapter = {
  body: (model, system, history, tools) => ({
    model, max_tokens: 4000, system, messages: history,
    ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) } : {}),
    ...(takesEffort(model) ? { output_config: { effort: 'low' } } : {}),
  }),
  parse: (r) => {
    const content: any[] = Array.isArray(r?.content) ? r.content : [];
    const stop = r?.stop_reason === 'tool_use' ? 'tool' : r?.stop_reason === 'refusal' ? 'refusal' : r?.stop_reason === 'max_tokens' ? 'length' : r?.stop_reason === 'end_turn' ? 'end' : 'other';
    return {
      text: content.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n\n').trim(),
      calls: content.filter((b) => b?.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), input: b.input && typeof b.input === 'object' ? b.input : {} })),
      stop,
      usage: { input: Number(r?.usage?.input_tokens ?? 0), output: Number(r?.usage?.output_tokens ?? 0) },
    };
  },
  // The whole content goes back (thinking blocks included, unchanged).
  assistant: (r) => ({ role: 'assistant', content: r?.content ?? [] }),
  user: (text) => [{ role: 'user', content: text }],
  // All results of one turn in one user message.
  results: (rs) => [{ role: 'user', content: rs.map((x) => ({ type: 'tool_result', tool_use_id: x.id, content: x.content, ...(x.error ? { is_error: true } : {}) })) }],
};

export const openai: Adapter = {
  body: (model, system, history, tools) => ({
    model, messages: [{ role: 'system', content: system }, ...history],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
  }),
  parse: (r) => {
    const choice = r?.choices?.[0] ?? {};
    const m = choice.message ?? {};
    const calls: ToolCall[] = (Array.isArray(m.tool_calls) ? m.tool_calls : []).map((c: any) => {
      let input: Record<string, unknown> = {};
      try { const v = JSON.parse(c?.function?.arguments || '{}'); if (v && typeof v === 'object') input = v; } catch { /* bad JSON: empty input */ }
      return { id: String(c?.id ?? ''), name: String(c?.function?.name ?? ''), input };
    });
    const f = choice.finish_reason;
    return {
      text: typeof m.content === 'string' ? m.content.trim() : '',
      calls,
      stop: calls.length || f === 'tool_calls' ? 'tool' : f === 'length' ? 'length' : f === 'content_filter' ? 'refusal' : f === 'stop' ? 'end' : 'other',
      usage: { input: Number(r?.usage?.prompt_tokens ?? 0), output: Number(r?.usage?.completion_tokens ?? 0) },
    };
  },
  assistant: (r) => {
    const m = r?.choices?.[0]?.message ?? {};
    return { role: 'assistant', content: m.content ?? null, ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}) };
  },
  user: (text) => [{ role: 'user', content: text }],
  results: (rs) => rs.map((x) => ({ role: 'tool', tool_call_id: x.id, content: x.content })),
};
export const adapterFor = (kind: ProviderKind) => (kind === 'anthropic' ? anthropic : openai);

// ---------- tools ----------

/** What the guide's tools need from the app. Each one only reads or opens a page: the person does the rest. */
export interface ToolEnv {
  state(): SetupState;
  checkAddress(url: string): Promise<unknown>;
  checkDocker(): Promise<unknown>;
  probe(): Promise<unknown>;
  providers(): Promise<unknown>;
  openLink(url: string): Promise<void>;
}

const LINK_HOSTS = ['console.anthropic.com', 'platform.claude.com', 'platform.openai.com', 'openrouter.ai', 'ollama.com', 'lmstudio.ai',
  'docs.docker.com', 'www.docker.com', 'learn.microsoft.com', 'git-scm.com', 'github.com', 'agentclientprotocol.com'];
export function linkAllowed(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && LINK_HOSTS.includes(u.hostname); } catch { return false; }
}

export const TOOLS: ToolDef[] = [
  { name: 'setup_state', description: "The setup checklist: the current step, the person's choices, the server address and the last result of each check.", schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'check_address', description: "Checks whether a Hearth server answers at an address (its /healthz page). Says what happened: ok, refused, timeout, dns, tls, or answered (something else is on that port). Leave url empty to check the address in the checklist.", schema: { type: 'object', properties: { url: { type: 'string', description: 'For example ws://192.168.1.20:8470/acp or 192.168.1.20:8470' } }, additionalProperties: false } },
  { name: 'check_docker', description: 'Checks whether Docker is installed on this computer and whether its engine is running.', schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'probe_server', description: "Connects to the saved server with the saved device key (ACP initialize) and says whether it worked. Only after the Connect step.", schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'server_providers', description: "Lists the saved server's model providers and whether each one works. Only after the Connect step.", schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'open_link', description: `Opens a web page in the person's browser. Only these sites: ${LINK_HOSTS.join(', ')}.`, schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'suggest_replies', description: 'Shows up to 4 short reply buttons under your message. Use for quick choices.', schema: { type: 'object', properties: { replies: { type: 'array', items: { type: 'string' }, maxItems: 4 } }, required: ['replies'], additionalProperties: false } },
];

/** A line for the chat saying what the guide just did. */
export function toolLabel(name: string): string {
  return ({ setup_state: 'Looked at the steps', check_address: 'Checked the server address', check_docker: 'Checked Docker on this computer',
    probe_server: 'Connected to the server', server_providers: "Checked the server's model providers", open_link: 'Opened a page in your browser' } as Record<string, string>)[name] ?? name;
}

export interface ToolOutcome { content: string; error?: boolean; replies?: string[] }

export async function runTool(env: ToolEnv, call: ToolCall): Promise<ToolOutcome> {
  const json = (v: unknown) => scrub(JSON.stringify(v ?? null));
  try {
    switch (call.name) {
      case 'setup_state': {
        const s = env.state();
        return { content: json({ step: s.step, where: s.where ?? null, address: s.address ?? null, connected: !!s.serverId, notes: s.notes ?? {}, guideModel: s.guide?.model ?? null }) };
      }
      case 'check_address': {
        const url = String(call.input.url ?? '').trim() || env.state().address;
        if (!url) return { content: 'No address yet: ask for one, or check the one in the checklist.', error: true };
        return { content: json(await env.checkAddress(url)) };
      }
      case 'check_docker': return { content: json(await env.checkDocker()) };
      case 'probe_server': return { content: json(await env.probe()) };
      case 'server_providers': return { content: json(await env.providers()) };
      case 'open_link': {
        const url = String(call.input.url ?? '');
        if (!linkAllowed(url)) return { content: `Not opened: only https pages on ${LINK_HOSTS.join(', ')}.`, error: true };
        await env.openLink(url);
        return { content: 'Opened.' };
      }
      case 'suggest_replies': {
        const replies = (Array.isArray(call.input.replies) ? call.input.replies : []).map((r) => String(r).slice(0, 60)).filter(Boolean).slice(0, 4);
        return { content: 'Shown.', replies };
      }
      default: return { content: `No tool named ${call.name}.`, error: true };
    }
  } catch (e) {
    return { content: scrub(`Failed: ${(e as Error)?.message ?? String(e)}`), error: true };
  }
}

// ---------- one turn ----------

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; label: string; error?: boolean }
  | { kind: 'error'; text: string };

export interface TurnResult { history: History; replies: string[]; usage: { input: number; output: number } }

/**
 * Sends the person's message and runs tool calls until the model answers (at most `rounds` model calls).
 * `call` is the shell's guide_call. Items for the chat arrive through `onItem` as they happen.
 */
export async function runTurn(opts: {
  guide: GuideModel; system: string; history: History; text: string;
  call: (body: Record<string, unknown>) => Promise<unknown>; env: ToolEnv; onItem: (i: ChatItem) => void; rounds?: number;
}): Promise<TurnResult> {
  const a = adapterFor(opts.guide.kind);
  let history: History = [...opts.history, ...a.user(opts.text)];
  const usage = { input: 0, output: 0 };
  let replies: string[] = [];
  for (let round = 0; round < (opts.rounds ?? 8); round++) {
    const resp = await opts.call(a.body(opts.guide.model, opts.system, history, TOOLS));
    const p = a.parse(resp);
    usage.input += p.usage.input; usage.output += p.usage.output;
    history = [...history, a.assistant(resp)];
    if (p.text) opts.onItem({ kind: 'assistant', text: p.text });
    if (p.stop === 'refusal') { opts.onItem({ kind: 'error', text: "The guide can't help with that one." }); break; }
    if (!p.calls.length) {
      if (p.stop === 'length') opts.onItem({ kind: 'error', text: 'The answer was cut off. Ask the guide to go on.' });
      break;
    }
    const outs = await Promise.all(p.calls.map((c) => runTool(opts.env, c)));
    p.calls.forEach((c, i) => {
      if (c.name !== 'suggest_replies') opts.onItem({ kind: 'tool', label: toolLabel(c.name), error: outs[i].error });
      if (outs[i].replies) replies = outs[i].replies!;
    });
    history = [...history, ...a.results(p.calls.map((c, i) => ({ id: c.id, content: outs[i].content, error: outs[i].error })))];
    if (round === (opts.rounds ?? 8) - 1) opts.onItem({ kind: 'error', text: 'The guide stopped after several checks. Ask it to go on.' });
  }
  return { history, replies, usage };
}

// ---------- what the guide knows ----------

export function osName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  return /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'unknown';
}

const PROMPT = `You are the setup guide inside Hearth, a desktop chat app. You help one person get Hearth working, then you're done. Next to you is a checklist of setup steps with buttons and fields; the person does the clicking and typing there.

## Hearth in short
- Hearth is two parts. The app (this window) shows chats. The server keeps the chats and runs the AI agents. The app connects to the server over a WebSocket (ACP) at an address like ws://192.168.1.20:8470/acp, using a device key made on the server.
- The server needs its own model provider (an Anthropic key, or an OpenAI-compatible endpoint such as OpenAI, OpenRouter or Ollama). The key you run on is only for this setup chat.

## The checklist
1. Model key: done, or you wouldn't be running.
2. Server: the person picks where it runs (this computer, another computer they own, or an address they were given), then enters the address and presses Check address.
3. Connect: they paste the device key into the key field and press Connect.
4. Model on the server: the app checks the server has a working model provider.
5. Done.

## Installing the server (Hearth Server, generic install)
Needs one always-on machine with Docker: Docker Desktop on Windows or macOS (Windows needs WSL 2 and virtualisation turned on in the BIOS), or Docker Engine with the compose plugin on Linux. Also git and bash; on Windows run the commands inside WSL (Ubuntu) or Git Bash.
\`\`\`
git clone https://github.com/usehearth/hearth-server.git
cd hearth-server/deploy/generic
cp .env.example .env
\`\`\`
Then edit .env and set one model key for the server: ANTHROPIC_API_KEY=... (Claude), or OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL for anything else. Then run \`./install.sh\`. The first build takes several minutes. At the end it prints the app address (ws://<that machine>:8470/acp) and a device key, shown once. The server's web page is http://<that machine>:8470 (user owner, password in secrets/web_password); if the device key was lost, make a new one there under Devices.
- The port is 8470 unless HEARTH_PORT in .env says otherwise.
- Logs: \`docker compose logs core\` (in deploy/generic). Restart after editing .env: \`docker compose up -d\`.
- The key in .env is only read on the server's first start, when it has no providers yet. After that, providers are added in the app (Settings, from an admin device; the admin tick is on the server's web page) or on the web page.

## When something fails
- check_address results: refused = nothing listening there (server not running, wrong port, or a firewall); timeout = wrong IP, other network, or a firewall dropping it; dns = the name doesn't resolve; tls = wss/https used but the server has no certificate (on a home network use ws://); answered = something else is on that port.
- localhost only works when the server runs on this same computer. From another device use the server machine's LAN IP. On a Windows server machine, allow port 8470 inbound in the Windows firewall.
- Connect refused the key: a typo, a key from another server, or the key was revoked. Make a new one on the server's web page.
- The server has no working provider: put a key in .env before the first start, or add one in the app's Settings from an admin device.

## How to help
- Short answers in plain words, one step at a time. Use code blocks for commands. No jargon without a short explanation.
- Check before guessing: use your tools (check_address, check_docker, probe_server, server_providers, setup_state).
- Use suggest_replies for quick choices.
- You can't run commands, change settings, or press the checklist's buttons. Say which button to press.
- Never ask for a key, password or token in the chat. Keys go only in the key fields of the checklist. Text shown as ${KEY_MARK} was a key that was removed before it reached you.
- If asked about something unrelated to setting up Hearth, answer briefly and steer back.`;

/** The system prompt: the fixed guide text, then the person's situation (it changes as they go). */
export function systemPrompt(s: SetupState, os: string): string {
  const where = s.where === 'here' ? 'this computer' : s.where === 'other' ? 'another computer they own' : s.where === 'given' ? 'an address they were given' : 'not chosen yet';
  const notes = Object.entries(s.notes ?? {}).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- none yet';
  return `${PROMPT}

## Right now
- This computer runs ${os}.
- Current step: ${s.step}. Server runs on: ${where}. Address: ${s.address ?? 'none yet'}. Connected: ${s.serverId ? 'yes' : 'no'}.
- Last check results:
${notes}`;
}

/** The guide's opening line, from the checklist alone (no model call). */
export function greeting(s: SetupState, resumed: boolean): string {
  if (!resumed) return "Your key works. I'm here to help you set up Hearth. Ask me anything along the way.\n\nFirst: where will your Hearth server run? Pick on the left, or ask me if you're not sure.";
  switch (s.step) {
    case 'server': return s.notes?.address ? `Welcome back. Last time the address check said: ${s.notes.address}. Want to try again?` : 'Welcome back. We were choosing where your server runs.';
    case 'connect': return 'Welcome back. Your server answered last time. Next is connecting with its device key.';
    case 'provider': return "Welcome back. You're connected. Last step: making sure your server has a working model.";
    default: return 'Welcome back.';
  }
}
