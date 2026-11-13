// Files the thread made (artifacts): every file its agent wrote or changed, newest first, with a preview. Read live
// from the project folder through the server (`_hearth/files`, `_hearth/file`); Hearth keeps nothing on disk.
// Pages run in a sandboxed frame with no access to Hearth (scripts allowed, so decks and small apps work).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileCode, FileImage, FileText, FileType, Globe, Loader2, Maximize2, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Markdown } from '@/components/hearth/Markdown';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

export interface FileItem { path: string; name: string; inProject: boolean; at: string; edits: number }
export interface FileContent extends FileItem { mimeType: string; size?: number; text?: string; dataBase64?: string; note?: string }

export function FilesList({ files, loading, onOpen, onRefresh }: { files: FileItem[] | null; loading: boolean; onOpen: (f: FileItem) => void; onRefresh: () => void }) {
  if (!files) return <div className="p-4">{loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}</div>;
  if (!files.length) return <p className="p-4 text-sm text-muted-foreground">No files yet. Files the agent writes or changes in this thread show up here.</p>;
  return (
    <div>
      <ul className="py-1">
        {files.map((f) => {
          const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
          const Icon = iconFor(f.path);
          return (
            <li key={f.path}>
              <button onClick={() => onOpen(f)} className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-accent/60" title={f.path}>
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{dir || (f.inProject ? 'project folder' : '')}{dir || f.inProject ? ' · ' : ''}{ago(f.at)}{f.edits > 1 ? ` · ${f.edits} changes` : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={onRefresh} className="mx-4 mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="size-3" />Refresh</button>
    </div>
  );
}

export function FileView({ file, read, onBack }: { file: FileItem; read: (path: string) => Promise<FileContent>; onBack: () => void }) {
  const [c, setC] = useState<FileContent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () => { setC(null); setErr(null); read(file.path).then(setC, (e) => setErr(errorText(e))); };
  useEffect(load, [file.path, file.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const blob = useMemo(() => (c ? toBlob(c) : null), [c]);
  const download = () => { if (!blob) return; const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  const copy = async () => { if (c?.text == null) return; await navigator.clipboard.writeText(c.text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <button onClick={onBack} aria-label="Back to files" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft className="size-4" /></button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.path}>{file.name}</span>
        {c?.text != null && <IconAct label={copied ? 'Copied' : 'Copy'} onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</IconAct>}
        {blob && <IconAct label="Download" onClick={download}><Download className="size-3.5" /></IconAct>}
        {c && !c.note && <IconAct label="Open large" onClick={() => setBig(true)}><Maximize2 className="size-3.5" /></IconAct>}
        <IconAct label="Read again" onClick={load}><RefreshCw className="size-3.5" /></IconAct>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {err && <p className="p-4 text-sm text-destructive">{err}</p>}
        {!c && !err && <div className="p-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
        {c && <Preview c={c} />}
      </div>
      <div className="truncate border-t px-4 py-1.5 font-mono text-[11px] text-muted-foreground" title={file.path}>{file.path}{c?.size != null ? ` · ${size(c.size)}` : ''}</div>
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="flex h-[88vh] max-w-[min(1200px,calc(100%-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100%-2rem))]">
          <DialogTitle className="truncate border-b px-5 py-3 pr-12 text-sm font-medium">{file.name}</DialogTitle>
          <div className="min-h-0 flex-1 overflow-auto">{c && <Preview c={c} large />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Preview({ c, large }: { c: FileContent; large?: boolean }) {
  const url = useMemo(() => (c.dataBase64 || c.mimeType === 'image/svg+xml' ? URL.createObjectURL(toBlob(c)) : null), [c]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (c.note) return <p className="p-4 text-sm text-muted-foreground">{c.note}</p>;
  const pad = large ? 'p-6' : 'p-4';
  if (c.mimeType === 'text/html') {
    return <iframe title={c.name} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={c.text ?? ''} className="block h-full min-h-[20rem] w-full border-0 bg-white" />;
  }
  if (c.mimeType.startsWith('image/') && url) return <div className={cn(pad, 'grid place-items-center')}><img src={url} alt={c.name} className="max-h-full max-w-full rounded-md" /></div>;
  if (c.mimeType === 'application/pdf' && url) return <iframe title={c.name} src={url} className="block h-full min-h-[20rem] w-full border-0" />;
  if (c.mimeType === 'text/markdown' && c.text != null) return <div className={pad}><Markdown text={c.text} /></div>;
  if ((c.mimeType === 'text/csv' || c.mimeType === 'text/tab-separated-values') && c.text != null) return <Table text={c.text} sep={c.mimeType === 'text/csv' ? ',' : '\t'} />;
  if (c.text != null) {
    let t = c.text;
    if (c.mimeType === 'application/json') { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch { /* as is */ } }
    return <pre className={cn(pad, 'font-mono text-xs leading-5 whitespace-pre-wrap break-words')}>{t}</pre>;
  }
  return <p className="p-4 text-sm text-muted-foreground">No preview for this kind of file. Download it to open it.</p>;
}

function Table({ text, sep }: { text: string; sep: string }) {
  const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 300).map((l) => splitRow(l, sep));
  return (
    <div className="p-3">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => i === 0
          ? <th key={j} className="sticky top-0 border-b bg-muted px-2 py-1 text-left font-medium">{v}</th>
          : <td key={j} className="border-b px-2 py-1">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** One CSV line into cells, with quoted fields. */
function splitRow(line: string, sep: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function toBlob(c: FileContent): Blob {
  if (c.dataBase64) { const b = atob(c.dataBase64); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Blob([u], { type: c.mimeType }); }
  return new Blob([c.text ?? ''], { type: c.mimeType });
}

function IconAct({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-label={label} title={label} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">{children}</button>;
}

function iconFor(p: string) {
  const e = (p.split('.').pop() ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return FileImage;
  if (['html', 'htm'].includes(e)) return Globe;
  if (['md', 'txt', 'markdown'].includes(e)) return FileText;
  if (['pdf', 'docx', 'pptx', 'xlsx'].includes(e)) return FileType;
  return FileCode;
}
function size(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }
function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
