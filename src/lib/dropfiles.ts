// Files the person drops or picks, as the claude.ai reader takes them (src/lib/claudeai.ts): a dropped folder is
// walked (every file, with its path inside the folder), a dropped or picked zip stays one file. The desktop app lets
// the page take drops itself (tauri.conf.json: dragDropEnabled false), so this works there and in a browser alike.
import { exportFile, type ExportFile } from './claudeai';

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string;
  file?: (ok: (f: File) => void, bad: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (es: Entry[]) => void, bad: (e: unknown) => void) => void } };

async function walk(e: Entry, out: ExportFile[]) {
  const path = e.fullPath.replace(/^\/+/, '');
  if (e.isFile && e.file) { out.push(exportFile(await new Promise<File>((ok, bad) => e.file!(ok, bad)), path)); return; }
  if (!e.isDirectory || !e.createReader) return;
  const reader = e.createReader();
  // readEntries hands them over in batches until it returns none.
  for (;;) {
    const batch = await new Promise<Entry[]>((ok, bad) => reader.readEntries(ok, bad));
    if (!batch.length) break;
    for (const c of batch) await walk(c, out);
  }
}

/** Everything in a drop: folders walked, files as they are. */
export async function filesFromDrop(dt: DataTransfer): Promise<ExportFile[]> {
  const out: ExportFile[] = [];
  const entries = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) { for (const e of entries) if (e) await walk(e, out); return out; }
  return [...dt.files].map((f) => exportFile(f));
}

/** Files from an <input type="file">: a folder picker gives each file its path inside the folder. */
export const filesFromInput = (list: FileList | null): ExportFile[] => [...(list ?? [])].map((f) => exportFile(f));
