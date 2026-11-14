// Thread management in the sidebar (server extension `threads`): a menu on each thread (rename, pin, archive,
// delete), search over names and what was said, and the archived threads. Every change goes to the server, which tells
// every window (`_hearth/sessions_changed`), so the list updates itself.
import { useEffect, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Archive, ArchiveRestore, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toItem, type ThreadItem } from '@/lib/directory';
import { cn } from '@/lib/utils';

export type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/** The "…" menu on a thread row. Main threads can be renamed by nobody and never archived or deleted, so get none. */
export function ThreadMenu({ t, request, onError }: { t: ThreadItem; request: Request; onError: (m: string) => void }) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const call = (method: string, params: Record<string, unknown>) => request(method, { sessionId: t.sessionId, ...params }).catch((e) => onError(errText(e)));
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
            <Item icon={t.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} onSelect={() => void call('_hearth/thread/pin', { pinned: !t.pinned })}>{t.pinned ? 'Unpin' : 'Pin'}</Item>
            <Item icon={<Archive className="size-3.5" />} onSelect={() => void call('_hearth/thread/archive', { archived: true })}>Archive</Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <Item icon={<Trash2 className="size-3.5" />} danger onSelect={() => setDialog('delete')}>Delete…</Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {dialog === 'rename' && <RenameDialog t={t} onClose={() => setDialog(null)} save={(title) => request('_hearth/thread/rename', { sessionId: t.sessionId, title })} />}
      {dialog === 'delete' && <DeleteDialog t={t} onClose={() => setDialog(null)} remove={() => request('_hearth/thread/delete', { sessionId: t.sessionId })} />}
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
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
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

/** The search box: as you type (2+ characters), threads whose name or text matches. */
export function SidebarSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="relative mx-3 mb-1">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search threads" aria-label="Search threads"
        onKeyDown={(e) => { if (e.key === 'Escape') onQuery(''); }}
        className="h-8 w-full rounded-lg border border-sidebar-border bg-background/60 pr-7 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40" />
      {query && <button aria-label="Clear search" onClick={() => onQuery('')} className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"><X className="size-3" /></button>}
    </div>
  );
}

export function SearchResults({ query, request, onOpen }: { query: string; request: Request; onOpen: (h: SearchHit) => void }) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      request<{ results: SearchHit[] }>('_hearth/threads/search', { query: q })
        .then((r) => { if (live) { setHits(r.results ?? []); setError(null); } }, (e) => live && setError(errText(e)));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, request]);
  if (query.trim().length < 2) return <p className="px-2 py-3 text-sm text-muted-foreground">Type at least two letters.</p>;
  if (error) return <p className="px-2 py-3 text-sm text-destructive">{error}</p>;
  if (!hits) return <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Searching…</div>;
  if (!hits.length) return <p className="px-2 py-3 text-sm text-muted-foreground">No threads match “{query.trim()}”.</p>;
  return (
    <ul className="space-y-0.5 pt-1" aria-label="Search results">
      {hits.map((h) => (
        <li key={h.sessionId}>
          <button onClick={() => onOpen(h)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent/60">
            <span className="block truncate text-[13px] font-medium">{h.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{h.project}{h.snippet ? ` · ${h.snippet}` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
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
