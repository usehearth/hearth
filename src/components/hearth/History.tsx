// Imported Claude Code conversations (`_hearth/history*`): a project's (or an unfiled group's) History list, a search
// across all imported history, and a read-only view of one conversation (tool calls collapsed like a live thread,
// subagent threads, paged). "Continue in Hearth" starts a new live thread in that project, its composer filled with a
// short summary. Client conversations come only to work devices; their body is read live from the work laptop.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Brain, ChevronDown, CircleAlert, History as HistoryIcon, Laptop, Loader2, Lock, NotebookText, Search, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/hearth/Markdown';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export interface ImportedSummary {
  id: string; title: string; source: string; group: string; project: string | null; projectName: string | null;
  startedAt: string | null; endedAt: string | null; messages: number; threads: number; client: boolean; unclear?: boolean; snippet?: string;
}
interface Item { line: number; role: 'user' | 'assistant' | 'thinking' | 'tool_call' | 'tool_result' | 'summary' | 'note'; ts?: string; text: string; name?: string; isError?: boolean }
interface ReadPage { conversation: ImportedSummary & { folder: string | null }; threads: { thread: string; kind: 'main' | 'subagent'; name: string }[]; thread: string; items: Item[]; next: number | null }
export interface Continued { sessionId: string; cwd: string; title: string; project: string; projectName: string; seed: string }
/** Where a History list comes from: a project, an unfiled group, or everything (search). */
export type HistoryScope = { project: string; name: string } | { group: string; name: string; client?: boolean } | Record<string, never>;

const OFFLINE = 'This client conversation is kept on the work laptop, which is off right now.';
const day = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const isOffline = (e: any) => e?.data?.code === 'laptop_offline' || /laptop, which is off/.test(String(e?.message));
const errOf = (e: unknown) => ({ text: isOffline(e) ? OFFLINE : errorText(e), offline: isOffline(e) });
const PAGE = 100;

export function HistoryView({ request, scope, onOpen }: { request: Request; scope: HistoryScope; onOpen: (s: ImportedSummary) => void }) {
  const [items, setItems] = useState<ImportedSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ImportedSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<{ clientUnavailable: boolean; titlesOnly: boolean }>({ clientUnavailable: false, titlesOnly: false });
  const where = 'project' in scope ? { project: scope.project } : 'group' in scope ? { group: scope.group } : {};
  const key = JSON.stringify(where);

  useEffect(() => {
    setItems(null); setErr(null); setQuery(''); setHits(null);
    request<{ items: ImportedSummary[]; more: boolean }>('_hearth/history', { ...where, limit: PAGE })
      .then((r) => { setItems(r.items); setMore(r.more); }, (e) => setErr(errorText(e)));
  }, [key, request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search as you type, after a short pause. Search covers all imported history; a project or group narrows it.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); setNote({ clientUnavailable: false, titlesOnly: false }); return; }
    setSearching(true);
    const t = setTimeout(() => {
      request<{ hits: ImportedSummary[]; clientUnavailable: boolean; titlesOnly: boolean }>('_hearth/history/search', { query: q })
        .then((r) => {
          const mine = r.hits.filter((h) => ('project' in scope ? h.project === scope.project : 'group' in scope ? h.group === scope.group && !h.project : true));
          setHits(mine); setNote({ clientUnavailable: r.clientUnavailable, titlesOnly: r.titlesOnly });
        }, (e) => setErr(errorText(e)))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, key, request]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    const r = await request<{ items: ImportedSummary[]; more: boolean }>('_hearth/history', { ...where, offset: items?.length ?? 0, limit: PAGE });
    setItems((cur) => [...(cur ?? []), ...r.items]); setMore(r.more);
  };

  const shown = hits ?? items;
  const heading = 'name' in scope ? `History · ${scope.name}` : 'Imported history';
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6 max-md:px-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><HistoryIcon className="size-5 text-muted-foreground" />{heading}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {'group' in scope ? 'Imported from a Claude Code folder that isn\'t a Hearth project. ' : 'Conversations imported from Claude Code. '}Read-only; continue any of them as a new thread.
        </p>
        <label className="mt-4 flex items-center gap-2 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={'name' in scope ? 'Search here' : 'Search all imported history'} aria-label="Search imported history"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" autoFocus={!('name' in scope)} />
          {searching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </label>
        {note.titlesOnly && hits && <p className="mt-2 text-xs text-muted-foreground">The search index isn't reachable right now, so only titles and folder names were searched.</p>}
        {note.clientUnavailable && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Laptop className="size-3.5" />Client conversations weren't searched: they're kept on the work laptop, which is off right now.</p>}
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
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {day(s.startedAt)} · {s.messages} messages{s.threads > 1 ? ` · ${s.threads - 1} subagent${s.threads > 2 ? 's' : ''}` : ''}{!('name' in scope) ? ` · ${s.projectName ?? s.group}` : ''}{s.unclear ? ' · not yet sorted' : ''}
                    </span>
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

/** One imported conversation, read-only, with its subagent threads and "Continue in Hearth". */
export function ImportedThread({ request, summary, onContinue }: { request: Request; summary: ImportedSummary; onContinue: (c: Continued) => void }) {
  const [page, setPage] = useState<ReadPage | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [thread, setThread] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<{ text: string; offline: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  // A conversation from a folder that isn't a project: Continue asks where.
  const [targets, setTargets] = useState<{ project: string; name: string }[] | null>(null);
  const [into, setInto] = useState('');

  useEffect(() => {
    setPage(null); setItems([]); setErr(null);
    request<ReadPage>('_hearth/history/read', { id: summary.id, ...(thread ? { thread } : {}), limit: 400 })
      .then((p) => { setPage(p); setItems(p.items); }, (e) => setErr(errOf(e)));
  }, [summary.id, thread, request]);
  useEffect(() => {
    if (summary.project) { setTargets(null); return; }
    request<{ projects: { project: string; name: string }[] }>('_hearth/history/targets', { client: summary.client })
      .then((r) => { setTargets(r.projects); setInto(r.projects[0]?.project ?? ''); }, () => setTargets([]));
  }, [summary.id, summary.project, summary.client, request]);

  const more = async () => {
    if (!page || page.next === null) return;
    setLoadingMore(true);
    try { const p = await request<ReadPage>('_hearth/history/read', { id: summary.id, thread: page.thread, offset: page.next, limit: 400 }); setPage(p); setItems((cur) => [...cur, ...p.items]); }
    catch (e) { setErr(errOf(e)); } finally { setLoadingMore(false); }
  };
  const go = async () => {
    setBusy(true);
    try { onContinue(await request<Continued>('_hearth/history/continue', { id: summary.id, ...(summary.project ? {} : { project: into }) })); }
    catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
  };
  const turns = useMemo(() => toTurns(items), [items]);

  if (err && !page) return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        {err.offline ? <Laptop className="mx-auto size-8 text-muted-foreground" /> : <CircleAlert className="mx-auto size-8 text-muted-foreground" />}
        <p className="mt-3 text-sm">{err.text}</p>
        {err.offline && <p className="mt-1 text-xs text-muted-foreground">Turn the laptop on and try again.</p>}
      </div>
    </div>
  );
  if (!page) return <div className="p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  const c = page.conversation;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[44rem] px-4 pt-4 pb-8">
          <div className="mb-5 rounded-xl border bg-muted/40 px-4 py-3 text-sm" role="note">
            <div className="flex items-center gap-2 font-medium"><HistoryIcon className="size-4 text-muted-foreground" />Imported from Claude Code, {day(c.startedAt)}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Read-only. {c.messages} messages{c.folder ? ` · ${c.folder}` : ''}{c.unclear ? ' · not yet sorted as personal or client' : ''}</p>
            {page.threads.length > 1 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Threads in this conversation">
                {page.threads.map((t) => (
                  <button key={t.thread} role="tab" aria-selected={t.thread === page.thread} onClick={() => setThread(t.kind === 'main' ? undefined : t.thread)}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', t.thread === page.thread ? 'border-foreground/30 bg-background font-medium' : 'text-muted-foreground hover:text-foreground')}>
                    {t.kind === 'main' ? 'Conversation' : `Subagent: ${t.name.replace(/^agent-/, '')}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-5">
            {turns.map((t, i) => t.role === 'user' ? (
              <div key={i} className="flex justify-end px-2">
                <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 wrap-break-word">{t.items.map((it, j) => <ItemView key={j} it={it} />)}</div>
              </div>
            ) : (
              <div key={i} className="space-y-1 px-2">{t.items.map((it, j) => <ItemView key={j} it={it} />)}</div>
            ))}
          </div>
          {page.next !== null && (
            <Button variant="outline" size="sm" className="mt-5" onClick={() => void more()} disabled={loadingMore}>{loadingMore && <Loader2 className="size-3.5 animate-spin" />}Show more of this conversation</Button>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t bg-background px-4 py-3">
        <div className="mx-auto flex max-w-[44rem] flex-wrap items-center gap-3">
          {targets && (
            <select value={into} onChange={(e) => setInto(e.target.value)} aria-label="Project to continue in"
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm">
              {targets.length === 0 && <option value="">No project to continue in</option>}
              {targets.map((t) => <option key={t.project} value={t.project}>{t.name}</option>)}
            </select>
          )}
          <Button onClick={() => void go()} disabled={busy || (!!targets && !into)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}Continue in Hearth</Button>
          <span className="text-xs text-muted-foreground">{targets ? 'Starts a new thread in the project you pick, with a short summary of this one.' : 'Starts a new thread in this project with a short summary of this one.'}</span>
          {err && <span className="text-sm text-destructive">{err.text}</span>}
        </div>
      </div>
    </div>
  );
}

/** A tool call with its result (the result that follows it). */
type Shown = Item | { role: 'tool'; call: Item; result?: Item };
/** Items into turns: the user's words in a bubble; everything the agent did (text, thinking, tools) in one block. */
function toTurns(items: Item[]): { role: 'user' | 'agent'; items: Shown[] }[] {
  const out: { role: 'user' | 'agent'; items: Shown[] }[] = [];
  const open: { role: 'tool'; call: Item; result?: Item }[] = [];
  for (const it of items) {
    if (it.role === 'tool_result') {
      const t = open.shift();
      if (t) { t.result = it; continue; }
    }
    const role = it.role === 'user' ? 'user' : 'agent';
    let last = out[out.length - 1];
    if (!last || last.role !== role) { last = { role, items: [] }; out.push(last); }
    if (it.role === 'tool_call') { const t = { role: 'tool' as const, call: it }; open.push(t); last.items.push(t); }
    else last.items.push(it);
  }
  return out;
}

function ItemView({ it }: { it: Shown }) {
  if (it.role === 'tool') {
    const r = it.result;
    return (
      <Folded icon={r?.isError ? <CircleAlert className="size-4 shrink-0 text-destructive" /> : <Wrench className="size-4 shrink-0" />} label={<>Used tool: <b>{it.call.name ?? 'tool'}</b>{hint(it.call.text) && <span className="ml-1 font-normal opacity-80">{hint(it.call.text)}</span>}</>}>
        <pre className="rounded-md bg-muted/50 p-2.5 text-xs break-words whitespace-pre-wrap text-foreground/90">{pretty(it.call.text)}</pre>
        {r && <>
          <p className="mt-2 text-xs font-medium text-muted-foreground">{r.isError ? 'Error' : 'Result'}</p>
          <pre className={cn('mt-1 max-h-80 overflow-y-auto rounded-md bg-muted/50 p-2.5 text-xs break-words whitespace-pre-wrap text-foreground/90', r.isError && 'text-destructive')}>{r.text}</pre>
        </>}
      </Folded>
    );
  }
  if (it.role === 'thinking') return <Folded icon={<Brain className="size-4 shrink-0" />} label="Thought"><p className="text-sm whitespace-pre-wrap text-muted-foreground">{it.text}</p></Folded>;
  if (it.role === 'summary') return <Folded icon={<NotebookText className="size-4 shrink-0" />} label="Earlier part of the conversation, summarised"><Markdown text={it.text} className="text-muted-foreground" /></Folded>;
  if (it.role === 'note' || it.role === 'tool_result') return <p className="text-xs text-muted-foreground italic">{it.text}</p>;
  if (it.text === '(an image)') return <p className="text-xs text-muted-foreground italic">[an image was attached here]</p>;
  return <Markdown text={it.text} />;
}

const pretty = (t: string) => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; } };
/** The one-line hint after a tool's name: its file or command. */
function hint(text: string): string {
  let i: Record<string, unknown> = {};
  try { i = JSON.parse(text); } catch { return ''; }
  const v = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url ?? i.description;
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
