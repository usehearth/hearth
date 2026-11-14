#!/usr/bin/env node
// hearth: Hearth from the terminal. See `hearth --help`.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createInterface as createLineReader } from 'node:readline';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { connect, type Hearth, type PermissionRequest, type SessionUpdate, type Thread, type ThreadInfo } from '@hearth/sdk';
import { configPath, normaliseUrl, readConfig, resolveServer, writeConfig } from './config.js';
import { runBridge } from './bridge.js';

const VERSION: string = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return '0.0.0'; }
})();

const HELP = `hearth ${VERSION}: Hearth from the terminal

Usage:
  hearth login --url <ws url> [--key <key>]   Save the server and device key (key read from stdin if not given)
  hearth threads [--archived] [--json]          List threads
  hearth search <query> [--json]                Search threads by title and content
  hearth chat [--project <p> | --thread <id>]   Interactive chat (/exit, /mode <default|acceptEdits|plan>)
  hearth run -p "<prompt>" [--project <p> | --thread <id>] [--json] [--allow-permissions]
                                                One turn, headless; exit code 0 on end_turn
  hearth acp [--project <p>]                    ACP stdio bridge for editors (Zed, JetBrains, any ACP client)

Options:
  -h, --help       Show this help
  -v, --version    Show the version

Config: ${configPath()}
HEARTH_URL and HEARTH_KEY override the saved config.
`;

class UsageError extends Error {}

const err = (s: string) => process.stderr.write(s + '\n');

function parse(args: string[], options: ParseArgsOptionsConfig) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

async function open(): Promise<Hearth> {
  const { url, key } = resolveServer();
  return connect({ url, key, clientName: 'hearth-cli', clientVersion: VERSION });
}

async function readStdin(): Promise<string> {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/** Asks for the key without echoing it. */
async function askHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const anyRl = rl as unknown as { _writeToOutput?: (s: string) => void };
  let prompted = false;
  anyRl._writeToOutput = (s: string) => {
    if (!prompted) { process.stderr.write(s); prompted = true; return; }
    if (s.includes('\n') || s.includes('\r')) process.stderr.write('\n');
  };
  try { return await rl.question(prompt); } finally { rl.close(); }
}

// ---- login ----
async function cmdLogin(args: string[]): Promise<number> {
  const { values } = parse(args, { url: { type: 'string' }, key: { type: 'string' } });
  const rawUrl = (values.url as string | undefined) ?? readConfig().url;
  if (!rawUrl) throw new UsageError('login needs --url <ws url>');
  const url = normaliseUrl(rawUrl);
  let key = (values.key as string | undefined)?.trim();
  if (!key) key = (process.stdin.isTTY ? await askHidden('Device key: ') : await readStdin()).trim();
  if (!key) throw new UsageError('No key given (use --key or pass it on stdin).');
  const hearth = await connect({ url, key, clientName: 'hearth-cli', clientVersion: VERSION });
  const agent = hearth.agentInfo?.title ?? hearth.agentInfo?.name ?? 'ACP server';
  hearth.close();
  const p = writeConfig({ url, key });
  err(`Logged in to ${agent} at ${url}. Saved to ${p}`);
  return 0;
}

// ---- threads / search ----
const publicThread = ({ raw: _raw, ...t }: ThreadInfo) => t;

async function cmdThreads(args: string[]): Promise<number> {
  const { values } = parse(args, { archived: { type: 'boolean' }, json: { type: 'boolean' } });
  const hearth = await open();
  try {
    const list = await hearth.threads(values.archived ? { archived: true } : {});
    if (values.json) { process.stdout.write(JSON.stringify(list.map(publicThread), null, 2) + '\n'); return 0; }
    if (!list.length) { err('No threads.'); return 0; }
    const rows = list.map((t) => [t.projectName || t.project, t.kind, t.status ?? '', t.updatedAt?.slice(0, 16).replace('T', ' ') ?? '', t.sessionId, t.title]);
    printTable(['PROJECT', 'KIND', 'STATUS', 'UPDATED', 'ID', 'TITLE'], rows);
    return 0;
  } finally { hearth.close(); }
}

async function cmdSearch(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'boolean' } });
  const query = positionals.join(' ').trim();
  if (!query) throw new UsageError('search needs a query');
  const hearth = await open();
  try {
    const results = await hearth.search(query);
    if (values.json) { process.stdout.write(JSON.stringify(results, null, 2) + '\n'); return 0; }
    if (!results.length) { err('No matches.'); return 0; }
    for (const r of results) {
      process.stdout.write(`${r.project}  ${r.sessionId}  ${r.title}\n`);
      if (r.snippet) process.stdout.write(`    ${String(r.snippet).replace(/\s+/g, ' ').slice(0, 200)}\n`);
    }
    return 0;
  } finally { hearth.close(); }
}

function printTable(head: string[], rows: string[][]) {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(width[i]))).join('  ');
  process.stdout.write([line(head), ...rows.map(line)].join('\n') + '\n');
}

// ---- shared turn helpers ----
const allowOption = (req: PermissionRequest) =>
  (req.options.find((o) => o.kind === 'allow_once') ?? req.options.find((o) => o.kind?.startsWith('allow')))?.optionId;
const rejectOption = (req: PermissionRequest) =>
  (req.options.find((o) => o.kind === 'reject_once') ?? req.options.find((o) => o.kind?.startsWith('reject')))?.optionId;
const toolTitle = (req: PermissionRequest) => String((req.toolCall as any)?.title ?? (req.toolCall as any)?.kind ?? 'a tool call');

async function openTarget(hearth: Hearth, v: { project?: string; thread?: string }): Promise<Thread> {
  if (v.project && v.thread) throw new UsageError('Use --project or --thread, not both.');
  if (v.thread) return hearth.openThread(v.thread);
  if (v.project) return hearth.newThread({ project: v.project });
  throw new UsageError('Pick a target: --project <project> (new thread) or --thread <id>.');
}

// ---- run ----
async function cmdRun(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    prompt: { type: 'string', short: 'p' },
    project: { type: 'string' },
    thread: { type: 'string' },
    json: { type: 'boolean' },
    'allow-permissions': { type: 'boolean' },
  });
  const prompt = ((values.prompt as string | undefined) ?? positionals.join(' ')).trim();
  if (!prompt) throw new UsageError('run needs -p "<prompt>"');
  const json = !!values.json;
  const hearth = await open();
  try {
    const thread = await openTarget(hearth, values as { project?: string; thread?: string });
    const r = await thread.send(prompt, {
      onText: json ? undefined : (s) => process.stdout.write(s),
      onPermission: (req) => {
        if (values['allow-permissions']) { err(`[allowed: ${toolTitle(req)}]`); return allowOption(req); }
        err(`[refused permission: ${toolTitle(req)} (pass --allow-permissions to allow)]`);
        return undefined;
      },
    });
    if (json) process.stdout.write(JSON.stringify({ sessionId: thread.sessionId, stopReason: r.stopReason, text: r.text }) + '\n');
    else if (r.text && !r.text.endsWith('\n')) process.stdout.write('\n');
    if (r.stopReason !== 'end_turn') err(`stopped: ${r.stopReason}`);
    return r.stopReason === 'end_turn' ? 0 : 1;
  } finally { hearth.close(); }
}

// ---- chat ----
async function cmdChat(args: string[]): Promise<number> {
  const { values } = parse(args, { project: { type: 'string' }, thread: { type: 'string' } });
  const hearth = await open();
  const rl = createLineReader({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  // Lines are queued so piped input isn't lost while a turn runs; `ask` takes the next one (null at end of input).
  const lines: string[] = [];
  const waiters: ((l: string | null) => void)[] = [];
  let closed = false;
  rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
  rl.on('close', () => { closed = true; for (const w of waiters.splice(0)) w(null); });
  let thread: Thread | undefined;
  let running = false;
  rl.on('SIGINT', () => {
    if (running && thread) { err('\n[cancelling]'); void thread.cancel().catch(() => {}); }
    else rl.close();
  });
  const ask = (q: string): Promise<string | null> => {
    if (process.stdin.isTTY) { rl.setPrompt(q); rl.prompt(); }
    if (lines.length) return Promise.resolve(lines.shift()!);
    if (closed) return Promise.resolve(null);
    return new Promise((res) => waiters.push(res));
  };
  try {
    thread = await openTarget(hearth, values as { project?: string; thread?: string });
    for (const m of thread.messages) process.stdout.write(`${m.role === 'user' ? 'you' : 'agent'}> ${m.text}\n`);
    err(`[thread ${thread.sessionId}; /exit to leave, /mode <default|acceptEdits|plan>, Ctrl+C cancels a turn]`);
    for (;;) {
      const line = await ask('you> ');
      if (line === null) break;
      const text = line.trim();
      if (!text) continue;
      if (text === '/exit' || text === '/quit') break;
      if (text.startsWith('/mode')) {
        const mode = text.slice(5).trim();
        if (!mode) { err('usage: /mode <default|acceptEdits|plan>'); continue; }
        try { await thread.setMode(mode); err(`[mode: ${mode}]`); } catch (e) { err(`[mode failed: ${(e as Error).message}]`); }
        continue;
      }
      running = true;
      // Answer text goes to stdout after `agent> `; tool lines and prompts go on their own lines.
      let started = false;
      let midLine = false;
      const breakLine = () => { if (midLine) { process.stdout.write('\n'); midLine = false; } };
      try {
        const r = await thread.send(text, {
          onText: (s) => {
            if (!started) { process.stdout.write('agent> '); started = true; }
            process.stdout.write(s);
            midLine = !s.endsWith('\n');
          },
          onUpdate: (u: SessionUpdate) => {
            if (u.sessionUpdate === 'tool_call') { breakLine(); err(`[tool: ${String(u.title ?? u.kind ?? 'tool')}]`); }
          },
          onPermission: async (req) => {
            breakLine();
            const a = await ask(`Allow ${toolTitle(req)}? [y/N] `);
            return a && /^y(es)?$/i.test(a.trim()) ? allowOption(req) : rejectOption(req);
          },
        });
        breakLine();
        if (r.stopReason !== 'end_turn') err(`[stopped: ${r.stopReason}]`);
      } catch (e) {
        breakLine();
        err(`[error: ${(e as Error).message}]`);
      } finally { running = false; }
    }
    return 0;
  } finally {
    rl.close();
    hearth.close();
  }
}

// ---- acp ----
async function cmdAcp(args: string[]): Promise<number> {
  const { values } = parse(args, { project: { type: 'string' } });
  const { url, key } = resolveServer();
  return runBridge({ url, key, project: values.project as string | undefined });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { process.stdout.write(HELP); return 0; }
  if (cmd === '-v' || cmd === '--version') { process.stdout.write(VERSION + '\n'); return 0; }
  if (rest.includes('-h') || rest.includes('--help')) { process.stdout.write(HELP); return 0; }
  switch (cmd) {
    case 'login': return cmdLogin(rest);
    case 'threads': return cmdThreads(rest);
    case 'search': return cmdSearch(rest);
    case 'chat': return cmdChat(rest);
    case 'run': return cmdRun(rest);
    case 'acp': return cmdAcp(rest);
    default: throw new UsageError(`Unknown command: ${cmd}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => {
    err(`hearth: ${(e as Error)?.message ?? String(e)}`);
    if (e instanceof UsageError) err('Run `hearth --help` for usage.');
    process.exitCode = e instanceof UsageError ? 2 : 1;
  },
);
