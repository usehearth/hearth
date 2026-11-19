// Recorded turns (from a real Hearth server, sanitised) and a few made-up ones, as scripts the fake server plays.
// A fixture line is one of:
//   {t, kind: 'session', modes, configOptions}      what session/new answered (first line)
//   {t, kind: 'prompt', text}                         what the user sent
//   {t, kind: 'update', update}                       a session/update, as sent
//   {t, kind: 'permission', params}                   a session/request_permission (no sessionId)
//   {t, kind: 'ext', method}                          a `_hearth/*` notification (plan_changed, files_changed)
//   {t, kind: 'end', stopReason}                      the turn's end
// `t` is milliseconds since the prompt was sent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Update = Record<string, unknown> & { sessionUpdate: string };
export type Step =
  | { t: number; kind: 'update'; update: Update }
  | { t: number; kind: 'permission'; params: { toolCall: Record<string, unknown>; options: { optionId: string; name: string; kind: string }[] } }
  | { t: number; kind: 'ext'; method: string }
  | { t: number; kind: 'end'; stopReason: string }
  /** Made-up steps for fault drills. */
  | { t: number; kind: 'drop' }
  | { t: number; kind: 'hang' }
  | { t: number; kind: 'fail'; message: string }
  /** Right after a permission step: another device answers it `afterMs` (real time) after it is asked. */
  | { t: number; kind: 'elsewhere'; optionId: string; afterMs: number }
  /** Nothing for `ms` (real time): a command that takes a while. */
  | { t: number; kind: 'pause'; ms: number };

export interface Script {
  name: string; prompt: string; steps: Step[]; modes?: unknown; configOptions?: unknown;
  /** Made-up scripts play in real time; recordings are sped up by the server's `speed`. */
  realtime?: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): Script {
  const lines = fs.readFileSync(path.join(here, 'fixtures', `${name}.jsonl`), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const session = lines.find((l) => l.kind === 'session');
  const prompt = lines.find((l) => l.kind === 'prompt')?.text ?? '';
  // Title and status updates belong to the recorded thread; the fake server sends its own.
  const steps = lines.filter((l) => l.kind !== 'session' && l.kind !== 'prompt' && l.update?.sessionUpdate !== 'session_info_update') as Step[];
  return { name, prompt, steps, modes: session?.modes, configOptions: session?.configOptions };
}

const text = (t: number, s: string): Step => ({ t, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: s } } });

/** A short answer in a few chunks. */
export function hello(prompt: string): Script {
  const words = `Hello from the fake server. You said: ${prompt.replace(/#\S+/g, '').trim() || '(nothing)'}`.split(/(?<= )/);
  const steps: Step[] = [];
  let t = 50;
  for (let i = 0; i < words.length; i += 3) steps.push(text((t += 40), words.slice(i, i + 3).join('')));
  steps.push({ t: t + 20, kind: 'update', update: { sessionUpdate: 'usage_update', used: 1200, size: 200000 } });
  steps.push({ t: t + 40, kind: 'end', stopReason: 'end_turn' });
  return { name: 'hello', prompt, steps };
}

/** A long answer: `n` chunks `every` ms apart. `dropAfter` closes the sender's socket after that many chunks. */
export function long(prompt: string, n = 60, every = 250, dropAfter?: number): Script {
  const steps: Step[] = [];
  for (let i = 1; i <= n; i++) {
    steps.push(text(i * every, `Step ${i} of ${n}. `));
    if (dropAfter === i) steps.push({ t: i * every + 1, kind: 'drop' });
  }
  steps.push({ t: (n + 1) * every, kind: 'end', stopReason: 'end_turn' });
  return { name: dropAfter ? 'drop' : 'long', prompt, steps, realtime: true };
}

/** Never answers and sends nothing. */
export const never = (prompt: string): Script => ({ name: 'never', prompt, steps: [{ t: 0, kind: 'hang' }], realtime: true });

/** Starts, then the turn fails with a server error. */
export const failing = (prompt: string): Script => ({ name: 'error', prompt, steps: [text(50, 'Working on it… '), { t: 400, kind: 'fail', message: 'The turn ended with "error": provider down' }], realtime: true });

/**
 * The recorded permission turn, but another device answers the prompt (allow once) `after` ms after it is asked: the
 * server withdraws its request from this window with `$/cancel_request`, as the real one does. The command then runs
 * for `runs` ms before anything more arrives.
 */
export function elsewhere(prompt: string, after = 1500, runs = 8000): Script {
  const base = loadFixture('permission');
  const steps: Step[] = [];
  for (const s of base.steps) {
    steps.push(s);
    if (s.kind === 'permission') steps.push({ t: s.t, kind: 'elsewhere', optionId: 'allow-once', afterMs: after }, { t: s.t, kind: 'pause', ms: runs });
  }
  return { ...base, name: 'elsewhere', prompt, steps };
}

/** Which script a prompt runs: a `#tag` in its text picks one; anything else gets a short hello. */
export function scriptFor(prompt: string): Script {
  const tag = /#([a-z-]+)/.exec(prompt)?.[1];
  switch (tag) {
    case 'subagent': case 'permission': case 'plan-and-edits': return { ...loadFixture(tag), prompt };
    case 'long': return long(prompt);
    case 'slow': return long(prompt, 16, 250);
    case 'drop': return long(prompt, 40, 200, 5);
    case 'never': return never(prompt);
    case 'error': return failing(prompt);
    case 'elsewhere': return elsewhere(prompt);
    default: return hello(prompt);
  }
}

/** A finished recorded turn as stored history: the user's message, then everything the agent sent. */
export function historyOf(script: Script, prompt = script.prompt): Update[] {
  const out: Update[] = [{ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: prompt } }];
  for (const s of script.steps) if (s.kind === 'update') out.push(s.update);
  return out;
}
