// How Hearth shows what the agent did, from the ACP tool call itself (kept on the part as providerMetadata.acp):
// edits as a real diff (old and new text, line numbers, unified or side by side), shell commands as a terminal
// (the command, its output with colours stripped, the exit code). Anything else keeps the plain fallback.
import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { Columns2, Rows3, SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AcpToolMeta {
  name?: string;
  kind?: string;
  title?: string;
  status?: string;
  locations?: { path: string; line?: number }[];
  content?: AcpContent[];
}
type AcpContent =
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'content'; content: { type: string; text?: string } | { type: string; text?: string }[] }
  | { type: 'terminal'; terminalId: string }
  | { type: string; [k: string]: unknown };

export const acpMetaOf = (part: { providerMetadata?: unknown }): AcpToolMeta | undefined =>
  (part.providerMetadata as { acp?: AcpToolMeta } | undefined)?.acp;

export const diffsOf = (m?: AcpToolMeta) =>
  (m?.content ?? []).filter((c): c is { type: 'diff'; path: string; oldText?: string | null; newText: string } => c.type === 'diff' && typeof (c as { path?: unknown }).path === 'string');

/** Text the call printed (content blocks), for shell commands. */
export function outputOf(m?: AcpToolMeta): string {
  const out: string[] = [];
  for (const c of m?.content ?? []) {
    if (c.type !== 'content') continue;
    const blocks = Array.isArray((c as { content: unknown }).content) ? (c as { content: { type: string; text?: string }[] }).content : [(c as { content: { type: string; text?: string } }).content];
    for (const b of blocks) if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
  }
  return out.join('\n');
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '');

export const isShell = (m?: AcpToolMeta, toolName?: string) => m?.kind === 'execute' || /^(bash|shell|execute)$/i.test(m?.name ?? toolName ?? '');

const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;

type Row = { kind: 'ctx' | 'add' | 'del' | 'gap'; a?: number; b?: number; text: string };

/** The line diff as rows, with unchanged runs longer than 2×context folded into a gap. */
export function diffRows(oldText: string, newText: string, context = 3): Row[] {
  const rows: Row[] = [];
  let a = 1, b = 1;
  for (const part of diffLines(oldText, newText)) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.value === '') continue;
    for (const text of lines) {
      if (part.added) rows.push({ kind: 'add', b: b++, text });
      else if (part.removed) rows.push({ kind: 'del', a: a++, text });
      else rows.push({ kind: 'ctx', a: a++, b: b++, text });
    }
  }
  // Fold long unchanged runs.
  const out: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'ctx') { out.push(rows[i++]); continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === 'ctx') j++;
    const run = rows.slice(i, j);
    const head = i === 0 ? 0 : context, tail = j === rows.length ? 0 : context;
    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head), { kind: 'gap', text: `${run.length - head - tail} unchanged lines` }, ...run.slice(run.length - tail));
    } else out.push(...run);
    i = j;
  }
  return out;
}

export function diffStats(oldText: string, newText: string) {
  let add = 0, del = 0;
  for (const p of diffLines(oldText, newText)) {
    const n = p.value.replace(/\n$/, '').split('\n').length;
    if (p.added) add += n; else if (p.removed) del += n;
  }
  return { add, del };
}

export function DiffView({ path, oldText, newText }: { path: string; oldText?: string | null; newText: string }) {
  const [split, setSplit] = useState(false);
  const old = oldText ?? '';
  const rows = useMemo(() => diffRows(old, newText), [old, newText]);
  const stats = useMemo(() => diffStats(old, newText), [old, newText]);
  return (
    <div className="overflow-hidden rounded-lg border bg-card text-xs" data-slot="hearth-diff">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono font-medium" title={path}>{base(path)}</span>
        {!oldText && <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">new file</span>}
        <span className="ml-auto font-mono text-emerald-700 dark:text-emerald-400">+{stats.add}</span>
        <span className="font-mono text-red-700 dark:text-red-400">−{stats.del}</span>
        <button onClick={() => setSplit((s) => !s)} title={split ? 'One column' : 'Side by side'} aria-label={split ? 'Show as one column' : 'Show side by side'}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground max-sm:hidden">
          {split ? <Rows3 className="size-3.5" /> : <Columns2 className="size-3.5" />}
        </button>
      </div>
      <div className="max-h-96 overflow-auto font-mono leading-5">
        {split ? <SplitRows rows={rows} /> : (
          <table className="w-full border-collapse"><tbody>
            {rows.map((r, i) => r.kind === 'gap'
              ? <tr key={i}><td colSpan={3} className="bg-muted/40 px-3 py-0.5 text-center text-[11px] text-muted-foreground">⋯ {r.text}</td></tr>
              : (
                <tr key={i} className={cn(r.kind === 'add' && 'bg-emerald-500/10', r.kind === 'del' && 'bg-red-500/10')}>
                  <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/70">{r.a ?? ''}</td>
                  <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/70">{r.b ?? ''}</td>
                  <td className="whitespace-pre-wrap break-all pr-3 pl-1">
                    <span className={cn('mr-2 select-none', r.kind === 'add' ? 'text-emerald-700 dark:text-emerald-400' : r.kind === 'del' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground/40')}>{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</span>{r.text}
                  </td>
                </tr>
              ))}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

/** Side by side: removed lines on the left, added on the right, unchanged lines on both. */
function SplitRows({ rows }: { rows: Row[] }) {
  const pairs: { l?: Row; r?: Row; gap?: string }[] = [];
  let dels: Row[] = [], adds: Row[] = [];
  const flush = () => { const n = Math.max(dels.length, adds.length); for (let i = 0; i < n; i++) pairs.push({ l: dels[i], r: adds[i] }); dels = []; adds = []; };
  for (const r of rows) {
    if (r.kind === 'del') dels.push(r);
    else if (r.kind === 'add') adds.push(r);
    else { flush(); pairs.push(r.kind === 'gap' ? { gap: r.text } : { l: r, r }); }
  }
  flush();
  const cell = (r: Row | undefined, side: 'l' | 'r') => (
    <>
      <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/70">{r ? (side === 'l' ? r.a : r.b) : ''}</td>
      <td className={cn('w-1/2 whitespace-pre-wrap break-all pr-3 pl-1 align-top', r?.kind === 'del' && 'bg-red-500/10', r?.kind === 'add' && 'bg-emerald-500/10', !r && 'bg-muted/30')}>{r?.text ?? ''}</td>
    </>
  );
  return (
    <table className="w-full table-fixed border-collapse"><tbody>
      {pairs.map((p, i) => p.gap
        ? <tr key={i}><td colSpan={4} className="bg-muted/40 px-3 py-0.5 text-center text-[11px] text-muted-foreground">⋯ {p.gap}</td></tr>
        : <tr key={i}>{cell(p.l, 'l')}{cell(p.r, 'r')}</tr>)}
    </tbody></table>
  );
}

export function TerminalView({ command, output, exitCode, running }: { command?: string; output: string; exitCode?: number | null; running?: boolean }) {
  const text = stripAnsi(output).replace(/\s+$/, '');
  return (
    <div className="overflow-hidden rounded-lg border bg-zinc-950 text-xs text-zinc-100 dark:bg-black/60" data-slot="hearth-terminal">
      <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-1.5 text-zinc-400">
        <SquareTerminal className="size-3.5" />
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-200"><span className="mr-1.5 text-zinc-500">$</span>{command ?? 'command'}</span>
        {running ? <span className="text-[11px]">running…</span>
          : exitCode != null && <span className={cn('rounded px-1.5 font-mono text-[10px]', exitCode === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300')}>exit {exitCode}</span>}
      </div>
      {text ? <pre className="max-h-80 overflow-auto px-3 py-2 font-mono leading-5 whitespace-pre-wrap break-words">{text}</pre>
        : !running && <p className="px-3 py-2 text-zinc-500">(no output)</p>}
    </div>
  );
}

/** The command a shell call ran, from its input. */
export function commandOf(args: unknown): string | undefined {
  const a = args as { command?: unknown; cmd?: unknown } | undefined;
  const c = a?.command ?? a?.cmd;
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : undefined;
}

/** The exit code a shell call reported (rawOutput shapes differ by engine). */
export function exitCodeOf(result: unknown): number | null {
  const r = result as { exitCode?: unknown; exit_code?: unknown; code?: unknown } | undefined;
  const v = r && typeof r === 'object' ? (r.exitCode ?? r.exit_code ?? r.code) : undefined;
  return typeof v === 'number' ? v : null;
}
