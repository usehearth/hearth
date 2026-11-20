// Reads claude.ai exports off the page's thread (src/lib/exportReader.ts starts it): a big export takes seconds to
// unzip and parse (287 MB of chats: 13 s), which would freeze the window. Files already read are remembered here
// (claudeai.ts keeps them by path, size and date), so adding another part reads only the new one.
import { readExports, type ExportFile } from './claudeai';

type In = { id: number; files: { path: string; file: File }[] };

self.onmessage = async (e: MessageEvent<In>) => {
  const { id, files } = e.data;
  try {
    const list: ExportFile[] = files.map(({ path, file }) => ({ path, size: file.size, lastModified: file.lastModified, bytes: async () => new Uint8Array(await file.arrayBuffer()) }));
    const result = await readExports(list);
    // Copied, not transferred: this worker keeps what it read for the next file added.
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
