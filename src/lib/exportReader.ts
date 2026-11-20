// The claude.ai export reader as the import screen uses it: in a background worker (src/lib/exportWorker.ts) when the
// files are real Files, so a big export never freezes the window; directly otherwise (tests, the server's proofs).
import { readExports, type ExportFile } from './claudeai';

type Result = Awaited<ReturnType<typeof readExports>>;
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (r: Result) => void; bad: (e: Error) => void }>();

function start(): Worker {
  const w = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: Result; error?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.ok) p.ok(e.data.result!); else p.bad(new Error(e.data.error ?? 'the export could not be read'));
  };
  // The worker itself failed (out of memory, say): every read waiting on it gets a plain error, and the next starts afresh.
  w.onerror = (e) => {
    for (const p of waiting.values()) p.bad(new Error(`The export could not be read: ${e.message || 'it may be too big to read here in one go'}. Add its parts a few at a time.`));
    waiting.clear();
    worker = null;
    try { w.terminate(); } catch { /* */ }
  };
  return w;
}

export async function readExportsInBackground(files: ExportFile[]): Promise<Result> {
  if (typeof Worker === 'undefined' || !files.every((f) => f.file)) return readExports(files);
  try { worker ??= start(); } catch { return readExports(files); }
  const id = ++seq;
  return new Promise<Result>((ok, bad) => {
    waiting.set(id, { ok, bad });
    worker!.postMessage({ id, files: files.map((f) => ({ path: f.path, file: f.file! })) });
  });
}
