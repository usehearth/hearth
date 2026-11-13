// Smoke test for `hearth acp` (the stdio ACP bridge) against a live Hearth server.
// Needs HEARTH_URL and HEARTH_KEY (and a project named by HEARTH_TEST_PROJECT, default `home`); skips without them.
// Spawns the bridge, writes initialize / session/new / session/prompt as JSON lines, and checks the answers and the
// streamed session/update notifications arrive on stdout, one JSON message per line.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

if (!process.env.HEARTH_URL || !process.env.HEARTH_KEY) {
  console.log('bridge-smoke: SKIPPED (set HEARTH_URL and HEARTH_KEY to run it against a server)');
  process.exit(0);
}

const project = process.env.HEARTH_TEST_PROJECT || 'home';
const cwd = process.env.HEARTH_TEST_CWD || 'C:/t/home';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'acp'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });

let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

const fail = (msg) => {
  console.error(`bridge-smoke: FAIL: ${msg}`);
  if (stderr.trim()) console.error(`bridge stderr:\n${stderr.trim()}`);
  child.kill();
  process.exit(1);
};
const timer = setTimeout(() => fail('timed out after 30s'), 30_000);

const waiting = new Map();
const updates = [];
let nonJson = 0;
createInterface({ input: child.stdout }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { nonJson++; fail(`stdout line is not JSON: ${line.slice(0, 120)}`); return; }
  if (msg.method === 'session/update') { updates.push(msg.params?.update?.sessionUpdate); return; }
  if (msg.method === 'session/request_permission') {
    // The bridge is transparent: the "editor" (this script) answers. Refuse.
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } }) + '\n');
    return;
  }
  if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
child.on('exit', (code) => { if (waiting.size) fail(`bridge exited (${code}) with requests pending`); });

let nextId = 0;
const request = (method, params) => new Promise((resolve) => {
  const id = ++nextId;
  waiting.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const ok = (msg, what) => {
  if (msg.error) fail(`${what} failed: ${JSON.stringify(msg.error)}`);
  return msg.result;
};

const init = ok(await request('initialize', {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'bridge-smoke', version: '0.0.0' },
}), 'initialize');
if (init?.protocolVersion !== 1) fail(`unexpected initialize result: ${JSON.stringify(init).slice(0, 200)}`);
console.log(`initialize: ok (agent ${init.agentInfo?.name ?? '?'}, ${init._meta?.hearth?.extensions?.length ?? 0} extensions)`);

const created = ok(await request('session/new', { cwd, mcpServers: [], _meta: { hearth: { project, title: 'bridge smoke test' } } }), 'session/new');
if (!created?.sessionId) fail('session/new returned no sessionId');
console.log(`session/new: ok (${created.sessionId})`);

const before = updates.length;
const prompt = ok(await request('session/prompt', { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'hello from the bridge smoke test' }] }), 'session/prompt');
const turn = updates.slice(before);
console.log(`session/prompt: stopReason=${prompt?.stopReason}, ${turn.length} updates (${[...new Set(turn)].join(', ')})`);
if (prompt?.stopReason !== 'end_turn') fail(`stopReason ${prompt?.stopReason}`);
if (!turn.includes('agent_message_chunk')) fail('no agent_message_chunk update arrived');

clearTimeout(timer);
child.stdin.end();
const code = await new Promise((r) => child.on('exit', r));
if (nonJson) fail('stdout had non-protocol lines');
console.log(`bridge exited with ${code} after stdin closed`);
console.log('bridge-smoke: PASS');
