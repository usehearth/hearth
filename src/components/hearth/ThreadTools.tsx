// Thread management in the sidebar (server extension `threads`): a menu on each thread (rename, pin, archive,
// delete), search over names and what was said, and the archived threads. Every change goes to the server, which tells
// every window (`_hearth/sessions_changed`), so the list updates itself.
import { useEffect, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Archive, ArchiveRestore, History as HistoryIcon, Loader2, Lock, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toItem, type ThreadItem } from '@/lib/directory';
import { cn } from '@/lib/utils';
import { resultMeta, usefulSnippet } from '@/lib/search';
import type { ImportedSummary } from '@/components/hearth/History';
import { field } from '@/components/ui/field';

export type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/** The "…" menu on a thread row. Main threads can be renamed by nobody and never archived or deleted, so get none. */
/**
 * onChanged runs after a change lands on the server: the list refreshes, and a thread that is now gone (deleted) or out
 * of the list (archived) is closed if it was open. Without it the sidebar kept a deleted thread, and deleting it again
 * said "Resource not found".
 */
export function ThreadMenu({ t, request, onError, onChanged }: { t: ThreadItem; request: Request; onError: (m: string) => void;
  onChanged?: (sessionId: string, change: 'deleted' | 'archived' | 'renamed' | 'pinned') => void }) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const call = (method: string, params: Record<string, unknown>, change: 'archived' | 'pinned') =>
    request(method, { sessionId: t.sessionId, ...params }).then(() => onChanged?.(t.sessionId, change), (e) => onError(errText(e)));
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button aria-label={`More for ${t.title}`} title="More"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md">
            <Item icon={<Pencil className="size-3.5" />} onSelect={() => setDialog('rename')}>Rename</Item>
            <Item icon={t.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} onSelect={() => void call('_hearth/thread/pin', { pinned: !t.pinned }, 'pinned')}>{t.pinned ? 'Unpin' : 'Pin'}</Item>
            <Item icon={<Archive className="size-3.5" />} onSelect={() => void call('_hearth/thread/archive', { archived: true }, 'archived')}>Archive</Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <Item icon={<Trash2 className="size-3.5" />} danger onSelect={() => setDialog('delete')}>Delete…</Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {dialog === 'rename' && <RenameDialog t={t} onClose={() => setDialog(null)} save={(title) => request('_hearth/thread/rename', { sessionId: t.sessionId, title }).then(() => onChanged?.(t.sessionId, 'renamed'))} />}
      {dialog === 'delete' && <DeleteDialog t={t} onClose={() => setDialog(null)} remove={() => request('_hearth/thread/delete', { sessionId: t.sessionId }).then(() => onChanged?.(t.sessionId, 'deleted'))} />}
    </>
  );
}

function Item({ icon, children, onSelect, danger }: { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item onSelect={onSelect}
      className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-accent', danger && 'text-destructive')}>
      {icon}{children}
    </DropdownMenu.Item>
  );
}

function RenameDialog({ t, onClose, save }: { t: ThreadItem; onClose: () => void; save: (title: string) => Promise<unknown> }) {
  const [title, setTitle] = useState(t.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true); setError(null);
    try { await save(title.trim()); onClose(); } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Rename thread</DialogTitle></DialogHeader>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Thread name"
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          className={field} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !title.trim()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ t, onClose, remove }: { t: ThreadItem; onClose: () => void; remove: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{t.title}”?</DialogTitle>
          <DialogDescription>Its messages are removed from the server for every device. This can't be undone. Archive it instead to keep it out of the list.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await remove(); onClose(); } catch (e) { setError(errText(e)); setBusy(false); }
          }}>{busy && <Loader2 className="size-3.5 animate-spin" />}Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface SearchHit { sessionId: string; project: string; title: string; updatedAt: string; client: boolean; snippet: string | null }

/** The search box: as you type (2+ characters), threads and imported history whose name or text matches. */
export function SidebarSearch({ query, onQuery, history }: { query: string; onQuery: (q: string) => void; /** Imported history is searched too. */ history?: boolean }) {
  const label = history ? 'Search threads and history' : 'Search threads';
  return (
    <div className="relative mx-3 mb-1">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={label} aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Escape') onQuery(''); }}
        className="h-8 w-full rounded-lg border border-sidebar-border bg-background/60 pr-7 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40" />
      {query && <button aria-label="Clear search" onClick={() => onQuery('')} className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"><X className="size-3" /></button>}
    </div>
  );
}

/**
 * One search over threads and, when the server keeps it, the imported Claude history: both are asked at once and shown
 * in two groups, each result with its project, its date and the words that matched.
 */
export function SearchResults({ query, request, onOpen, history, projectName = (s) => s, onOpenImported }: {
  query: string; request: Request; onOpen: (h: SearchHit) => void;
  /** Search the imported history too (server extension `history`). */ history?: boolean;
  /** A project's name from its slug. */ projectName?: (slug: string) => string;
  onOpenImported?: (s: ImportedSummary) => void;
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [past, setPast] = useState<ImportedSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastNote, setPastNote] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); setPast(null); return; }
    let live = true;
    const t = setTimeout(() => {
      request<{ results: SearchHit[] }>('_hearth/threads/search', { query: q })
        .then((r) => { if (live) { setHits(r.results ?? []); setError(null); } }, (e) => live && setError(errText(e)));
      if (history) {
        request<{ hits: ImportedSummary[]; clientUnavailable?: boolean; titlesOnly?: boolean }>('_hearth/history/search', { query: q })
          .then((r) => { if (live) { setPast(r.hits ?? []); setPastNote(r.titlesOnly ? 'Only titles were searched: the search index is unavailable right now.' : null); } },
            () => { if (live) { setPast([]); setPastNote("Imported history couldn't be searched right now."); } });
      } else setPast([]);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, request, history]);
  if (query.trim().length < 2) return <p className="px-2 py-3 text-sm text-muted-foreground">Type at least two letters.</p>;
  if (error) return <p className="px-2 py-3 text-sm text-destructive">{error}</p>;
  if (!hits || !past) return <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Searching…</div>;
  if (!hits.length && !past.length) return <p className="px-2 py-3 text-sm text-muted-foreground">Nothing matches “{query.trim()}”{history ? ' in threads or imported history' : ''}.{pastNote ? ` ${pastNote}` : ''}</p>;
  const row = 'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent/60';
  return (
    <div className="space-y-2 pt-1">
      {hits.length > 0 && (
        <section aria-label="Threads">
          {history && <div className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground">Threads <span className="tabular-nums">{hits.length}</span></div>}
          <ul className="space-y-0.5" aria-label="Search results">
            {hits.map((h) => (
              <li key={h.sessionId}>
                <button onClick={() => onOpen(h)} className={row}>
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{h.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{resultMeta({ project: projectName(h.project), at: h.updatedAt, snippet: usefulSnippet(h.title, h.snippet) })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section aria-label="Imported history">
          <div className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground">Imported history <span className="tabular-nums">{past.length}</span></div>
          <ul className="space-y-0.5">
            {past.map((h) => (
              <li key={h.id}>
                <button onClick={() => onOpenImported?.(h)} disabled={!onOpenImported} className={row}>
                  {h.client ? <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Client" /> : <HistoryIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{h.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{resultMeta({ project: h.projectName ?? h.group, at: h.startedAt, dateOnly: true, snippet: usefulSnippet(h.title, h.snippet) })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pastNote && (hits.length > 0 || past.length > 0) && <p className="px-2 text-[11px] text-muted-foreground">{pastNote}</p>}
    </div>
  );
}

/** Archived threads (server extension `threads`): open one, or put it back in the list. */
export function ArchivedList({ request, onOpen, onError }: { request: Request; onOpen: (t: ThreadItem) => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const load = () => request<{ sessions: unknown[] }>('session/list', { _meta: { hearth: { archived: true } } })
    .then((r) => setItems((r.sessions ?? []).map(toItem)), (e) => onError(errText(e)));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading…</div>;
  if (!items.length) return <p className="px-2 py-3 text-sm text-muted-foreground">Nothing archived.</p>;
  return (
    <ul className="space-y-0.5 pt-1" aria-label="Archived threads">
      {items.map((t) => (
        <li key={t.sessionId} className="group/row flex items-center gap-1 rounded-lg pr-1 hover:bg-sidebar-accent/60">
          <button onClick={() => onOpen(t)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
            <span className="block truncate text-[13px]">{t.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{t.projectName}</span>
          </button>
          <button aria-label={`Unarchive ${t.title}`} title="Put back in the list"
            onClick={() => request('_hearth/thread/archive', { sessionId: t.sessionId, archived: false }).then(load, (e) => onError(errText(e)))}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><ArchiveRestore className="size-3.5" /></button>
        </li>
      ))}
    </ul>
  );
}
