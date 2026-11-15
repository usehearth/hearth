// The import wizard's engine (no UI): find conversations on this machine (desktop app: Claude Code folders through
// src-tauri/src/import.rs) or in a claude.ai export, ask the server for a plan (`_hearth/import/preview`), then
// upload each new or changed conversation in chunks and commit it (`_hearth/import/begin|file|commit|finish`).
// Re-runnable: the server says what it already has, so a second run moves only what is new or changed.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** The desktop app (Tauri) can read this machine's folders; a browser can't. (Same test as servers.ts; kept here so
 * the engine also loads outside the app, e.g. in the server's import proof.) */
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

/** One conversation found on this machine or in an export. */
export interface LocalUnit {
  id: string; folder: string; uuid: string; source: 'claude-code' | 'claude-ai'; fingerprint: string;
  cwd: string | null; repo: string | null; hint?: string | null; title: string; started: string | null; ended: string | null;
  messages: number; threads: number; bytes: number; files: { rel: string; size: number }[]; from: string;
  /** Desktop scan only: the folder it was found in (shown locally, never sent). */
  root?: string;
}
export interface LocalSource { path: string; label: string; kind: 'claude-code' | 'archive'; conversations: number; account?: string | null }

export interface Proposal {
  key: string; name: string; slug: string; path: string; client: string | null; existing: string | null; existingName?: string | null; mergeInto?: string;
  conversations: number; bytes: number; new: number; changed: number; unchanged: number; refile: number; last: string | null;
}
export interface Preview {
  token: string; proposals: Proposal[]; pools: string[]; defaultPool: string; clientPool: string | null;
  projects: { slug: string; name: string; client: string | null }[];
  totals: { conversations: number; bytes: number; new: number; changed: number; unchanged: number; refile: number };
}
export type Choice = { action: 'new'; name: string; slug: string; client: string | null } | { action: 'existing'; slug: string } | { action: 'merge'; into: string } | { action: 'skip' };
export interface Begun { runId: number; created: string[]; upload: { id: string; folder: string; uuid: string; files: { rel: string; size: number }[] }[]; refiled: number; unchanged: number; skipped: number; chunkBytes: number }

/** Reads bytes of one file of a conversation. */
export type Reader = (u: LocalUnit, rel: string, offset: number, length: number) => Promise<Uint8Array>;

export const canScanThisMachine = isDesktop;

export async function localSources(): Promise<LocalSource[]> {
  if (!isDesktop) return [];
  return invoke<LocalSource[]>('import_sources');
}

/** Scan the chosen folders. `onProgress(done, total)` while it reads. */
export async function scanLocal(paths: string[], onProgress?: (done: number, total: number) => void): Promise<{ home: string; units: LocalUnit[] }> {
  const off = onProgress ? await listen<[number, number]>('import-scan', (e) => onProgress(e.payload[0], e.payload[1])) : null;
  try { return await invoke<{ home: string; units: LocalUnit[] }>('import_scan', { paths }); }
  finally { off?.(); }
}

export const localReader: Reader = async (u, rel, offset, length) => new Uint8Array(await invoke<ArrayBuffer>('import_read', { id: u.id, rel, offset, length }));
export const memoryReader = (bytes: Map<string, Uint8Array>): Reader => async (_u, rel, offset, length) => (bytes.get(rel) ?? new Uint8Array()).subarray(offset, offset + length);

/** The same conversation found twice (an archive copy and the original): keep the bigger one. */
export function mergeUnits(lists: { units: LocalUnit[]; reader: Reader }[]): Map<string, { unit: LocalUnit; reader: Reader }> {
  const out = new Map<string, { unit: LocalUnit; reader: Reader }>();
  for (const l of lists) for (const u of l.units) { const had = out.get(u.id); if (!had || had.unit.bytes < u.bytes) out.set(u.id, { unit: u, reader: l.reader }); }
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What the wizard sends for a plan: metadata only (no file content). */
export const previewOf = (request: Request, units: LocalUnit[], home: string) =>
  request<Preview>('_hearth/import/preview', { home, units: units.map(({ from: _f, root: _r, ...u }) => u) });

/** Default choices from a preview: existing projects as they are, suggested merges applied, everything else new. */
export function defaultChoices(p: Preview): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const x of p.proposals) {
    out[x.key] = x.existing ? { action: 'existing', slug: x.existing } : x.mergeInto ? { action: 'merge', into: x.mergeInto } : { action: 'new', name: x.name, slug: x.slug, client: x.client };
  }
  return out;
}

export interface Progress { done: number; total: number; bytesDone: number; bytesTotal: number; current: string; failed: { title: string; error: string }[] }

/**
 * Upload every conversation the server asked for, one at a time: each file in chunks (resuming where the server says
 * it has got to), then commit. A conversation that fails is reported and skipped; the next run tries it again.
 */
export async function upload(request: Request, begun: Begun, units: Map<string, { unit: LocalUnit; reader: Reader }>, onProgress: (p: Progress) => void, stop?: () => boolean) {
  const chunk = Math.min(begun.chunkBytes || 4 << 20, 4 << 20);
  const p: Progress = { done: 0, total: begun.upload.length, bytesDone: 0, bytesTotal: begun.upload.reduce((n, u) => n + u.files.reduce((m, f) => m + f.size, 0), 0), current: '', failed: [] };
  onProgress({ ...p });
  for (const item of begun.upload) {
    if (stop?.()) break;
    const local = units.get(item.id);
    if (!local) { p.failed.push({ title: item.id, error: 'not found on this machine any more' }); continue; }
    p.current = local.unit.title;
    onProgress({ ...p, failed: [...p.failed] });
    try {
      for (const f of item.files) {
        let offset = 0, guard = 0;
        for (;;) {
          const want = Math.min(chunk, Math.max(0, f.size - offset));
          const data = want ? await local.reader(local.unit, f.rel, offset, want) : new Uint8Array();
          const last = offset + data.length >= f.size || data.length < want;
          const r = await request<{ next: number }>('_hearth/import/file', { runId: begun.runId, id: item.id, rel: f.rel, offset, data: toBase64(data), last });
          p.bytesDone += data.length;
          if (r.next !== offset + data.length) { // the server lost its place (e.g. it restarted): go back to where it is
            if (++guard > 5) throw new Error('the server kept losing its place in this file');
            p.bytesDone -= offset + data.length - r.next; offset = r.next; continue;
          }
          offset = r.next;
          if (last) break;
        }
      }
      await request('_hearth/import/commit', { runId: begun.runId, id: item.id });
    } catch (e: any) {
      p.failed.push({ title: local.unit.title, error: String(e?.message ?? e).slice(0, 200) });
    }
    p.done++;
    onProgress({ ...p, failed: [...p.failed] });
  }
  return request<{ runId: number; report: any }>('_hearth/import/finish', { runId: begun.runId });
}
