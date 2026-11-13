// `hearth acp`: a stdio ACP bridge. Editors that run ACP agents as a subprocess (newline-delimited JSON-RPC on
// stdin/stdout) talk to the Hearth server's WebSocket through it. Both sides already speak ACP, so this is a
// transparent relay: one JSON-RPC message per line in, one WebSocket text frame out, and back. The only change made
// to traffic: with --project, a `session/new` without `_meta.hearth.project` gets it.
// stdout carries protocol messages only; everything else goes to stderr.
import { createInterface } from 'node:readline';

type Json = Record<string, any>;

const log = (msg: string) => process.stderr.write(`hearth acp: ${msg}\n`);

export async function runBridge(opts: { url: string; key: string; project?: string }): Promise<number> {
  const ws = new WebSocket(opts.url, ['acp', `bearer.${opts.key}`]);
  const queue: string[] = [];
  /** Requests from the editor still waiting for the server's answer (answered with an error if the socket dies). */
  const pending = new Set<string | number>();
  let open = false;
  let finished = false;

  const out = (line: string) => process.stdout.write(line + '\n');

  const send = (text: string) => {
    if (open && ws.readyState === WebSocket.OPEN) ws.send(text);
    else queue.push(text);
  };

  const fail = (reason: string) => {
    for (const id of pending) out(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `Hearth: ${reason}` } }));
    pending.clear();
  };

  return new Promise<number>((resolve) => {
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      rl.close();
      try { ws.close(); } catch { /* */ }
      // Let stdout drain before leaving.
      process.stdout.write('', () => resolve(code));
    };

    ws.addEventListener('open', () => {
      open = true;
      for (const t of queue.splice(0)) ws.send(t);
    });
    ws.addEventListener('message', (ev) => {
      let text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8');
      let msg: Json | undefined;
      try { msg = JSON.parse(text); } catch { log('dropped a non-JSON frame from the server'); return; }
      if (text.includes('\n')) text = JSON.stringify(msg); // one message per line
      if (msg && msg.id !== undefined && msg.method === undefined) pending.delete(msg.id);
      out(text);
    });
    ws.addEventListener('error', () => { /* the close event follows with the details */ });
    ws.addEventListener('close', (ev) => {
      const why = open ? `server closed the connection (${ev.code}${ev.reason ? ` ${ev.reason}` : ''})` : "can't reach the server, or it refused the key";
      log(why);
      fail(why);
      finish(open && ev.code === 1000 ? 0 : 1);
    });

    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: Json;
      try { msg = JSON.parse(trimmed); } catch {
        out(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      let text = trimmed;
      if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
        if (msg.method !== undefined && msg.id !== undefined) pending.add(msg.id);
        if (opts.project && msg.method === 'session/new') {
          const params: Json = msg.params && typeof msg.params === 'object' ? msg.params : {};
          const meta: Json = params._meta && typeof params._meta === 'object' ? params._meta : {};
          const hearth: Json = meta.hearth && typeof meta.hearth === 'object' ? meta.hearth : {};
          if (!hearth.project) {
            msg.params = { ...params, _meta: { ...meta, hearth: { ...hearth, project: opts.project } } };
            text = JSON.stringify(msg);
          }
        }
      }
      send(text);
    });
    rl.on('close', () => {
      // The editor closed stdin: we're done once nothing is in flight to the server.
      if (finished) return;
      const wait = () => (pending.size === 0 ? finish(0) : setTimeout(wait, 50));
      wait();
    });
  });
}
