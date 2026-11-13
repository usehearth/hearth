// Imported Claude conversations (`_hearth/history*`): a project's History list, a search across all imported history,
// and a read-only view of one conversation (tool calls collapsed like a live thread). "Continue in Hearth" starts a
// new live thread in that project, its composer filled with a short summary of the imported one.
// Client conversations come only to work devices; their body is read live from the work laptop.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Brain, ChevronDown, CircleAlert, History as HistoryIcon, Laptop, Loader2, Lock, Search, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/hearth/Markdown';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export interface ImportedSummary {
  id: string; project: string; title: string; source: string; startedAt: string; endedAt: string; messages: number; client: boolean; snippet?: string;
}
type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; text: string; isError: boolean }
  | { type: 'image'; mimeType: string; omitted: true };
interface Conversation extends ImportedSummary { cwd: string | null; model: string | null; body: { role: 'user' | 'assistant'; at: string | null; blocks: Block[] }[] }
export interface Continued { sessionId: string; cwd: string; title: string; project: string; projectName: string; seed: string }

const OFFLINE = 'This client conversation is kept on the work laptop, which is off right now.';
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const sourceName = (s: string) => (s === 'claude-ai' ? 'Claude' : 'Claude Code');
const isOffline = (e: any) => e?.data?.code === 'laptop_offline' || /laptop, which is off/.test(String(e?.message));

/** A project's imported conversations, or (no project) a search across every imported conversation. */
export function HistoryView({ request, project, projectName, onOpen }: {
  request: Request; project?: string; projectName?: string; onOpen: (s: ImportedSummary) => void;
}) {
  const [items, setItems] = useState<ImportedSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ImportedSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [clientUnavailable, setClientUnavailable] = useState(false);

  useEffect(() => {
    setItems(null); setErr(null); setQuery(''); setHits(null);
    request<{ items: ImportedSummary[]; more: boolean }>('_hearth/history', project ? { project, limit: 100 } : { limit: 100 })
      .then((r) => { setItems(r.items); setMore(r.more); }, (e) => setErr(errorText(e)));
  }, [project, request]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); setClientUnavailable(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      request<{ hits: ImportedSummary[]; clientUnavailable: boolean }>('_hearth/history/search', { query: q, ...(project ? { project } : {}) })
        .then((r) => { setHits(r.hits); setClientUnavailable(r.clientUnavailable); }, (e) => setErr(errorText(e)))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, project, request]);

  const loadMore = async () => {
    const before = items?.[items.length - 1]?.endedAt;
    const r = await request<{ items: ImportedSummary[]; more: boolean }>('_hearth/history', { ...(project ? { project } : {}), before, limit: 100 });
    setItems((cur) => [...(cur ?? []), ...r.items]); setMore(r.more);
  };

  const shown = hits ?? items;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6 max-md:px-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><HistoryIcon className="size-5 text-muted-foreground" />{project ? `History · ${projectName ?? project}` : 'Imported history'}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Conversations imported from Claude, read-only. Continue any of them as a new thread.</p>
        <label className="mt-4 flex items-center gap-2 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={project ? 'Search this project\'s history' : 'Search all imported history'} aria-label="Search imported history"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" autoFocus={!project} />
          {searching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </label>
        {clientUnavailable && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Laptop className="size-3.5" />Client conversations weren't searched: they're kept on the work laptop, which is off right now.</p>}
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        {!shown && !err && <Loader2 className="mt-4 size-4 animate-spin text-muted-foreground" />}
        {shown && shown.length === 0 && <p className="mt-4 text-sm text-muted-foreground">{hits ? 'Nothing matches.' : 'No imported conversations here.'}</p>}
        {shown && shown.length > 0 && (
          <ul className="mt-3 divide-y rounded-xl border bg-card">
            {shown.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpen(s)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-accent/50">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">{s.client && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Client" />}<span className="truncate">{s.title}</span></span>
                    {s.snippet && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">…{s.snippet.replace(/\s+/g, ' ')}…</span>}
                    <span className="mt-0.5 block text-xs text-muted-foreground">{day(s.endedAt)} · {s.messages} messages{!project ? ` · ${s.project}` : ''}</span>
                  </span>
                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!hits && more && <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadMore()}>Show older</Button>}
      </div>
    </div>
  );
}

/** One imported conversation, read-only, with "Continue in Hearth". */
export function ImportedThread({ request, id, onContinue }: { request: Request; id: string; onContinue: (c: Continued) => void }) {
  const [c, setC] = useState<Conversation | null>(null);
  const [err, setErr] = useState<{ text: string; offline: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setC(null); setErr(null);
    request<Conversation>('_hearth/history/read', { id }).then(setC, (e) => setErr({ text: isOffline(e) ? OFFLINE : errorText(e), offline: isOffline(e) }));
  }, [id, request]);
  // Tool results by the call they answer, so each call shows its own result.
  const results = useMemo(() => {
    const m = new Map<string, { text: string; isError: boolean }>();
    for (const msg of c?.body ?? []) for (const b of msg.blocks) if (b.type === 'tool_result') m.set(b.toolUseId, b);
    return m;
  }, [c]);
  const go = async () => {
    setBusy(true);
    try { onContinue(await request<Continued>('_hearth/history/continue', { id })); }
    catch (e) { setErr({ text: isOffline(e) ? OFFLINE : errorText(e), offline: isOffline(e) }); }
    finally { setBusy(false); }
  };

  if (err && !c) return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        {err.offline ? <Laptop className="mx-auto size-8 text-muted-foreground" /> : <CircleAlert className="mx-auto size-8 text-muted-foreground" />}
        <p className="mt-3 text-sm">{err.text}</p>
        {err.offline && <p className="mt-1 text-xs text-muted-foreground">Turn the laptop on and try again.</p>}
      </div>
    </div>
  );
  if (!c) return <div className="p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[44rem] px-4 pt-4 pb-8">
          <div className="mb-5 rounded-xl border bg-muted/40 px-4 py-3 text-sm" role="note">
            <div className="flex items-center gap-2 font-medium"><HistoryIcon className="size-4 text-muted-foreground" />Imported from {sourceName(c.source)}, {day(c.startedAt)}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Read-only. {c.messages} messages{c.cwd ? ` · ${c.cwd}` : ''}{c.model ? ` · ${c.model}` : ''}</p>
          </div>
          <div className="space-y-5">
            {c.body.map((m, i) => {
              const visible = m.blocks.filter((b) => b.type !== 'tool_result');
              if (!visible.length) return null;
              return m.role === 'user' ? (
                <div key={i} className="flex justify-end px-2">
                  <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 wrap-break-word">
                    {visible.map((b, j) => <BlockView key={j} b={b} results={results} />)}
                  </div>
                </div>
              ) : (
                <div key={i} className="space-y-1 px-2">{visible.map((b, j) => <BlockView key={j} b={b} results={results} />)}</div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t bg-background px-4 py-3">
        <div className="mx-auto flex max-w-[44rem] items-center gap-3">
          <Button onClick={() => void go()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}Continue in Hearth</Button>
          <span className="text-xs text-muted-foreground">Starts a new thread in this project with a short summary of this one.</span>
          {err && <span className="text-sm text-destructive">{err.text}</span>}
        </div>
      </div>
    </div>
  );
}

function BlockView({ b, results }: { b: Block; results: Map<string, { text: string; isError: boolean }> }) {
  if (b.type === 'text') return <Markdown text={b.text} />;
  if (b.type === 'image') return <p className="text-xs text-muted-foreground italic">[an image was attached here]</p>;
  if (b.type === 'thinking') return <Folded icon={<Brain className="size-4 shrink-0" />} label="Thought"><p className="text-sm whitespace-pre-wrap text-muted-foreground">{b.text}</p></Folded>;
  if (b.type === 'tool_use') {
    const r = results.get(b.id);
    return (
      <Folded icon={r?.isError ? <CircleAlert className="size-4 shrink-0 text-destructive" /> : <Wrench className="size-4 shrink-0" />} label={<>Used tool: <b>{b.name}</b>{hint(b.input) && <span className="ml-1 font-normal opacity-80">{hint(b.input)}</span>}</>}>
        <pre className="rounded-md bg-muted/50 p-2.5 text-xs break-words whitespace-pre-wrap text-foreground/90">{JSON.stringify(b.input, null, 2)}</pre>
        {r && <>
          <p className="mt-2 text-xs font-medium text-muted-foreground">{r.isError ? 'Error' : 'Result'}</p>
          <pre className={cn('mt-1 max-h-80 overflow-y-auto rounded-md bg-muted/50 p-2.5 text-xs break-words whitespace-pre-wrap text-foreground/90', r.isError && 'text-destructive')}>{r.text}</pre>
        </>}
      </Folded>
    );
  }
  return null;
}

/** The one-line hint after a tool's name: its file or command. */
function hint(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const v = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url;
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ');
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}

function Folded({ icon, label, children }: { icon: React.ReactNode; label: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-fit max-w-full items-center gap-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        {icon}<span className="min-w-0 truncate">{label}</span><ChevronDown className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="mb-2 ml-6 border-l pl-3">{children}</div>}
    </div>
  );
}
