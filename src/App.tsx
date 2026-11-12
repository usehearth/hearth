import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Flame, Loader2, MoonStar, Plus, RefreshCw, Server as ServerIcon, Sun, TriangleAlert } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ThreadPane, type ThreadTarget } from '@/components/hearth/ThreadPane';
import { AddServer, KeyPrompt } from '@/components/hearth/AddServer';
import { useDirectory, type ProjectGroup, type ThreadItem } from '@/lib/directory';
import { keyFor, useServers } from '@/lib/servers';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export default function App() {
  const servers = useServers();
  const [serverId, setServerId] = useState<string | undefined>(servers[0]?.id);
  const server = servers.find((s) => s.id === serverId) ?? servers[0];
  const [keyVersion, setKeyVersion] = useState(0);
  const dir = useDirectory(server, keyVersion);
  // `id` keys the open pane (stable for its lifetime); `sessionId` is the server's id once known.
  const [target, setTarget] = useState<{ id: string; sessionId?: string; t: ThreadTarget; title: string; project?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { dark, toggle } = useTheme();

  useEffect(() => { if (!serverId && servers[0]) setServerId(servers[0].id); }, [servers, serverId]);
  // Open the most recent project's main thread once the list arrives.
  useEffect(() => {
    if (dir.state !== 'ready' || target) return;
    const g = dir.groups[0];
    const first = g?.main ?? g?.threads[0];
    if (first) open(first);
  }, [dir.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((t: ThreadItem) => {
    setError(null);
    setTarget({ id: t.sessionId, sessionId: t.sessionId, t: { kind: 'open', sessionId: t.sessionId, cwd: t.cwd }, title: t.kind === 'main' ? 'Main thread' : t.title, project: t.projectName });
  }, []);
  const newThread = useCallback((g: ProjectGroup) => {
    setError(null);
    const id = `new-${crypto.randomUUID()}`;
    setTarget({ id, t: { kind: 'new', cwd: g.cwd, meta: { hearth: { project: g.project } } }, title: 'New thread', project: g.name });
  }, []);
  const refresh = dir.state === 'ready' ? dir.refresh : undefined;
  const events = useMemo(() => ({
    onError: (m: string) => setError(m),
    onSession: (sessionId: string) => setTarget((t) => {
      if (!t || t.sessionId === sessionId) return t;
      refresh?.(); // a new thread now exists on the server
      return { ...t, sessionId };
    }),
    onTitle: (title: string) => setTarget((t) => (t && t.title !== title && t.title !== 'Main thread' ? { ...t, title } : t)),
    onTurnEnd: () => refresh?.(),
  }), [refresh]);

  if (!servers.length || adding) {
    return <AddServer first={!servers.length} onDone={(id) => { setAdding(false); setServerId(id); setTarget(null); setKeyVersion((v) => v + 1); }} onCancel={servers.length ? () => setAdding(false) : undefined} />;
  }

  const key = server ? keyFor(server.id) : undefined;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {/* Sidebar: the server's own chat list */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <img src="/logo.svg" alt="" className="size-7 rounded-lg shadow-sm" />
            <span className="text-[15px] font-semibold tracking-tight">Hearth</span>
            <div className="ml-auto flex items-center gap-0.5">
              <IconBtn label={dark ? 'Light mode' : 'Dark mode'} onClick={toggle}>{dark ? <Sun className="size-4" /> : <MoonStar className="size-4" />}</IconBtn>
            </div>
          </div>
          <button onClick={() => setAdding(true)} className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sidebar-accent" title="Servers">
            <ServerIcon className="size-4 text-muted-foreground" />
            <span className="truncate font-medium">{server?.name}</span>
            <StatusDot state={dir.state} />
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          </button>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {dir.state === 'connecting' && <SidebarSkeleton />}
            {dir.state === 'no-key' && server && <KeyPrompt server={server} onSaved={() => setKeyVersion((v) => v + 1)} />}
            {dir.state === 'error' && (
              <div className="mx-1 mt-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="size-4" />Not connected</div>
                <p className="mt-1 text-muted-foreground">{dir.message}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={dir.retry}><RefreshCw className="size-3.5" />Retry</Button>
                  {server && <KeyPrompt compact server={server} onSaved={() => setKeyVersion((v) => v + 1)} />}
                </div>
              </div>
            )}
            {dir.state === 'ready' && (
              <>
                <div className="flex items-center justify-between px-2 pt-2 pb-1">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Projects</span>
                  <IconBtn label="Refresh" onClick={dir.refresh}><RefreshCw className="size-3.5" /></IconBtn>
                </div>
                {dir.groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No threads on this server yet.</p>}
                {dir.groups.map((g) => (
                  <ProjectSection key={g.project} g={g} activeId={target?.sessionId} onOpen={open} onNew={() => newThread(g)} />
                ))}
              </>
            )}
          </nav>
          <div className="border-t border-sidebar-border px-4 py-2.5 text-[11px] text-muted-foreground">
            {dir.state === 'ready' ? <>Connected to {dir.agent}. Chats live on the server.</> : 'Chats live on the server, not this device.'}
          </div>
        </aside>

        {/* Main: the open thread */}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
            {target ? (
              <>
                <span className="truncate text-sm font-medium">{target.title}</span>
                {target.project && <span className="truncate text-sm text-muted-foreground">· {target.project}</span>}
              </>
            ) : <span className="text-sm text-muted-foreground">Pick a thread</span>}
          </header>
          {error && (
            <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><span className="text-foreground/90">{error}</span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {target && server && key
              ? <ThreadPane key={target.id} url={server.url} serverKey={key} target={target.t} events={events} />
              : <Welcome />}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function ProjectSection({ g, activeId, onOpen, onNew }: { g: ProjectGroup; activeId?: string; onOpen: (t: ThreadItem) => void; onNew: () => void }) {
  const [openSec, setOpenSec] = useState(true);
  const recent = useMemo(() => [...g.threads].sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)), [g.threads]);
  return (
    <div className="mt-1">
      <div className="group flex items-center rounded-lg pr-1 hover:bg-sidebar-accent/60">
        <button onClick={() => setOpenSec((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[13px] font-semibold">
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !openSec && '-rotate-90')} />
          <span className="truncate">{g.name}</span>
        </button>
        <IconBtn label={`New thread in ${g.name}`} onClick={onNew} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Plus className="size-3.5" /></IconBtn>
      </div>
      {openSec && (
        <ul className="ml-2 border-l border-sidebar-border pl-1.5">
          {g.main && <ThreadRow t={g.main} active={activeId === g.main.sessionId} onOpen={onOpen} main />}
          {recent.slice(0, 12).map((t) => <ThreadRow key={t.sessionId} t={t} active={activeId === t.sessionId} onOpen={onOpen} />)}
        </ul>
      )}
    </div>
  );
}

function ThreadRow({ t, active, onOpen, main }: { t: ThreadItem; active: boolean; onOpen: (t: ThreadItem) => void; main?: boolean }) {
  const running = t.status === 'running' || t.status === 'starting';
  const needs = t.status === 'needs_permission';
  return (
    <li>
      <button onClick={() => onOpen(t)} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60')}>
        {main ? <Flame className="size-3.5 shrink-0 text-ember" /> : <span className="size-3.5 shrink-0" />}
        <span className="truncate">{main ? 'Main thread' : t.title}</span>
        {needs && <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">needs you</span>}
        {running && !needs && <Loader2 className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground" />}
      </button>
    </li>
  );
}

function StatusDot({ state }: { state: string }) {
  const c = state === 'ready' ? 'bg-emerald-500' : state === 'error' || state === 'no-key' ? 'bg-destructive' : 'bg-amber-400 animate-pulse';
  return <span className={cn('size-1.5 shrink-0 rounded-full', c)} aria-label={state} />;
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
      className={cn('grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground', className)}>
      {children}
    </button>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-3" aria-label="Loading">
      {[60, 45, 70, 50].map((w, i) => <div key={i} className="h-6 animate-pulse rounded-md bg-sidebar-accent" style={{ width: `${w}%` }} />)}
    </div>
  );
}

function Welcome() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <img src="/logo.svg" alt="" className="mx-auto size-14 rounded-2xl shadow-md" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Your AI, at home</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a thread on the left, or start a new one with the + next to a project.</p>
      </div>
    </div>
  );
}
