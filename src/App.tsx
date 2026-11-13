import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellDot, Briefcase, ChevronDown, Lock, Menu, Settings as SettingsIcon, SlidersHorizontal, Flame, Loader2, MoonStar, Pin, Plus, RefreshCw, Server as ServerIcon, Sun, TriangleAlert } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ThreadPane, type ThreadTarget } from '@/components/hearth/ThreadPane';
import { AddServer, KeyPrompt } from '@/components/hearth/AddServer';
import { NeedsYou } from '@/components/hearth/NeedsYou';
import { Settings } from '@/components/hearth/Settings';
import { ProjectSettings } from '@/components/hearth/ProjectSettings';
import type { CardEntry } from '@/lib/hearth';
import { useDirectory, type ClientLine, type ProjectGroup, type ThreadItem } from '@/lib/directory';
import { keyFor, keysReady, useServers } from '@/lib/servers';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export default function App() {
  const servers = useServers();
  const [serverId, setServerId] = useState<string | undefined>(servers[0]?.id);
  const server = servers.find((s) => s.id === serverId) ?? servers[0];
  const [keyVersion, setKeyVersion] = useState(0);
  const dir = useDirectory(server, keyVersion);
  // `id` keys the open pane (stable for its lifetime); `sessionId` is the server's id once known.
  const [target, setTarget] = useState<{ id: string; sessionId?: string; t: ThreadTarget; title: string; project?: string; client?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The main pane shows the open thread, or the needs-you view.
  const [view, setView] = useState<'thread' | 'needs' | 'settings' | 'project'>('thread');
  const [projectView, setProjectView] = useState<{ slug: string; name: string } | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  // Phones: the sidebar is a drawer, closed whenever something is picked in it.
  const [navOpen, setNavOpen] = useState(false);
  const go = useCallback((v: 'thread' | 'needs' | 'settings' | 'project') => { setView(v); setNavOpen(false); }, []);
  const { dark, toggle } = useTheme();

  useEffect(() => { if (!serverId && servers[0]) setServerId(servers[0].id); }, [servers, serverId]);
  // Desktop: keys arrive from the keychain shortly after start.
  useEffect(() => { void keysReady.then(() => setKeyVersion((v) => v + 1)); }, []);
  // Open the most recent project's main thread once the list arrives.
  useEffect(() => {
    if (dir.state !== 'ready' || target) return;
    const g = dir.groups[0];
    const first = g?.main ?? g?.threads[0];
    if (first) open(first);
  }, [dir.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((t: ThreadItem) => {
    setError(null);
    setView('thread');
    setNavOpen(false);
    // The thread already open stays connected (coming back from Needs you, or a second click).
    setTarget((cur) => (cur?.sessionId === t.sessionId ? cur : { id: t.sessionId, sessionId: t.sessionId, t: { kind: 'open', sessionId: t.sessionId, cwd: t.cwd }, title: t.kind === 'main' ? 'Main thread' : t.title, project: t.projectName, client: t.client }));
  }, []);
  const openCard = useCallback((e: CardEntry) => {
    setError(null);
    setView('thread');
    setNavOpen(false);
    setTarget((cur) => (cur?.sessionId === e.sessionId ? cur : { id: e.sessionId, sessionId: e.sessionId, t: { kind: 'open', sessionId: e.sessionId, cwd: e.cwd }, title: e.kind === 'main' ? 'Main thread' : e.title, project: e.projectName }));
  }, []);
  const newThread = useCallback((g: ProjectGroup) => {
    setError(null);
    setView('thread');
    setNavOpen(false);
    const id = `new-${crypto.randomUUID()}`;
    setTarget({ id, t: { kind: 'new', cwd: g.cwd, meta: { hearth: { project: g.project } } }, title: 'New thread', project: g.name, client: g.client });
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
        {navOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
        {/* Sidebar: the server's own chat list (a drawer on phones) */}
        <aside className={cn('flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar pt-safe pb-safe text-sidebar-foreground',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[85vw] max-md:max-w-80 max-md:shadow-2xl max-md:transition-transform max-md:duration-200',
          !navOpen && 'max-md:-translate-x-full')} aria-label="Threads">
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <img src="/logo.svg" alt="" className="size-7 rounded-lg shadow-sm" />
            <span className="text-[15px] font-semibold tracking-tight">Hearth</span>
            <div className="ml-auto flex items-center gap-0.5">
              <IconBtn label={dark ? 'Light mode' : 'Dark mode'} onClick={toggle}>{dark ? <Sun className="size-4" /> : <MoonStar className="size-4" />}</IconBtn>
              <IconBtn label="Settings" onClick={() => go('settings')} className={view === 'settings' ? 'bg-sidebar-accent text-foreground' : undefined}><SettingsIcon className="size-4" /></IconBtn>
            </div>
          </div>
          <button onClick={() => go('settings')} className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sidebar-accent" title="Servers">
            <ServerIcon className="size-4 text-muted-foreground" />
            <span className="truncate font-medium">{server?.name}</span>
            <StatusDot state={dir.state === 'ready' && dir.reconnecting ? 'reconnecting' : dir.state} />
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          </button>
          {dir.state === 'ready' && (
            <button onClick={() => go('needs')} aria-current={view === 'needs' ? 'page' : undefined}
              className={cn('mx-3 mb-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-sidebar-accent', view === 'needs' && 'bg-sidebar-accent font-medium')}>
              <BellDot className={cn('size-4', dir.cards.length ? 'text-primary' : 'text-muted-foreground')} />
              <span>Needs you</span>
              {dir.cards.length > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{dir.cards.length}</span>}
              {dir.cards.length === 0 && dir.clients.some((c) => c.needsYou > 0) && <span className="ml-auto text-[11px] text-muted-foreground">client work waits</span>}
            </button>
          )}
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
                {dir.groups.filter((g) => !g.client).map((g) => (
                  <ProjectSection key={g.project} g={g} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} onNew={() => newThread(g)}
                    onSettings={dir.extensions.includes('project') ? () => { setProjectView({ slug: g.project, name: g.name }); go('project'); } : undefined}
                    settingsOpen={view === 'project' && projectView?.slug === g.project} />
                ))}
                <ClientsSection groups={dir.groups.filter((g) => !!g.client)} lines={dir.clients} workDevice={dir.workDevice}
                  render={(g) => (
                    <ProjectSection key={g.project} g={g} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} onNew={() => newThread(g)}
                      onSettings={dir.extensions.includes('project') ? () => { setProjectView({ slug: g.project, name: g.name }); go('project'); } : undefined}
                      settingsOpen={view === 'project' && projectView?.slug === g.project} />
                  )} />
              </>
            )}
          </nav>
          <div className="border-t border-sidebar-border px-4 py-2.5 text-[11px] text-muted-foreground">
            {dir.state === 'ready' ? (dir.reconnecting ? 'Reconnecting…' : <>Connected to {dir.agent}. Chats live on the server.</>) : 'Chats live on the server, not this device.'}
          </div>
        </aside>

        {/* Main: the open thread */}
        <main className="flex min-w-0 flex-1 flex-col pb-safe">
          <header className="flex shrink-0 items-center gap-2 border-b px-5 pt-safe max-md:px-3 [&>*]:my-auto" style={{ minHeight: 'calc(3rem + env(safe-area-inset-top))' }}>
            <button onClick={() => setNavOpen(true)} aria-label="Open threads" className="relative -ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden">
              <Menu className="size-5" />
              {dir.state === 'ready' && dir.cards.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" aria-label="Something needs you" />}
            </button>
            {view === 'project' && projectView ? <><span className="truncate text-sm font-medium">{projectView.name}</span><span className="text-sm text-muted-foreground">· Project settings</span></> : view === 'settings' ? <span className="text-sm font-medium">Settings</span> : view === 'needs' ? <span className="text-sm font-medium">Needs you</span> : target ? (
              <>
                <span className="truncate text-sm font-medium">{target.title}</span>
                {target.project && <span className="truncate text-sm text-muted-foreground">· {target.project}</span>}
              </>
            ) : <span className="text-sm text-muted-foreground">Pick a thread</span>}
            <div ref={setActionsEl} className={cn('ml-auto flex items-center gap-1', view !== 'thread' && 'hidden')} />
          </header>
          {view === 'thread' && target?.client && (
            <div className="flex items-center gap-2 border-b bg-amber-500/10 px-5 py-1.5 text-xs text-amber-900 max-md:px-3 dark:text-amber-200" role="note">
              <Lock className="size-3.5 shrink-0" />
              <span><span className="font-semibold">Client: {target.client}.</span> Content stays on the work machine; the server keeps only summaries.</span>
            </div>
          )}
          {error && (
            <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><span className="text-foreground/90">{error}</span>
            </div>
          )}
          {view === 'settings' && (
            <div className="min-h-0 flex-1">
              <Settings servers={servers} server={server} dir={dir} onAdd={() => setAdding(true)}
                onUse={(id) => { setServerId(id); setTarget(null); setView('thread'); }} onKeyChanged={() => setKeyVersion((v) => v + 1)} />
            </div>
          )}
          {view === 'project' && projectView && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><ProjectSettings project={projectView.slug} request={dir.request} /></div>
          )}
          {view === 'needs' && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><NeedsYou cards={dir.cards} onAnswer={dir.answer} onOpen={openCard} /></div>
          )}
          {/* The open thread stays mounted behind the needs-you view, so going back keeps its place. */}
          <div className={cn('min-h-0 flex-1', view !== 'thread' && 'hidden')}>
            {target && server && key
              ? <ThreadPane key={target.id} url={server.url} serverKey={key} target={target.t} events={events} actionsEl={actionsEl} />
              : <Welcome />}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function ProjectSection({ g, activeId, onOpen, onNew, onSettings, settingsOpen }: { g: ProjectGroup; activeId?: string; onOpen: (t: ThreadItem) => void; onNew: () => void; onSettings?: () => void; settingsOpen?: boolean }) {
  const [openSec, setOpenSec] = useState(true);
  const [all, setAll] = useState(false);
  // Pinned first, then most recent.
  const recent = useMemo(() => [...g.threads].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)), [g.threads]);
  const needs = [g.main, ...g.threads].filter((t) => t && needsYou(t)).length;
  const shown = all ? recent : recent.slice(0, SHOW);
  return (
    <div className="mt-1">
      <div className="group flex items-center rounded-lg pr-1 hover:bg-sidebar-accent/60">
        <button onClick={() => setOpenSec((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[13px] font-semibold">
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !openSec && '-rotate-90')} />
          <span className="truncate">{g.name}</span>
          {!openSec && needs > 0 && <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary" title="Threads that need you">{needs}</span>}
        </button>
        {onSettings && <IconBtn label={`Settings for ${g.name}`} onClick={onSettings} className={cn('opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100', settingsOpen && 'bg-sidebar-accent text-foreground opacity-100')}><SlidersHorizontal className="size-3.5" /></IconBtn>}
        <IconBtn label={`New thread in ${g.name}`} onClick={onNew} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"><Plus className="size-3.5" /></IconBtn>
      </div>
      {openSec && (
        <ul className="ml-2 border-l border-sidebar-border pl-1.5">
          {g.main && <ThreadRow t={g.main} active={activeId === g.main.sessionId} onOpen={onOpen} main />}
          {shown.map((t) => <ThreadRow key={t.sessionId} t={t} active={activeId === t.sessionId} onOpen={onOpen} />)}
          {recent.length > SHOW && (
            <li>
              <button onClick={() => setAll((v) => !v)} className="w-full rounded-lg px-2 py-1 pl-7.5 text-left text-[12px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground">
                {all ? 'Show fewer' : `Show ${recent.length - SHOW} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * H5: client projects in their own section. A work device lists their threads like any other project; elsewhere it
 * gets one content-free line per client and the content stays on the work machine.
 */
function ClientsSection({ groups, lines, workDevice, render }: { groups: ProjectGroup[]; lines: ClientLine[]; workDevice: boolean; render: (g: ProjectGroup) => React.ReactNode }) {
  if (!groups.length && !lines.length) return null;
  return (
    <div className="mt-3" aria-label="Clients">
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <Briefcase className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Clients</span>
      </div>
      {workDevice || groups.length ? groups.map(render) : lines.map((l) => (
        <div key={l.client} className="mx-1 flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px]">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{l.client}</span>
            <span className="block text-xs text-muted-foreground">{l.needsYou > 0 ? `${l.needsYou} ${l.needsYou === 1 ? 'thing needs' : 'things need'} you: open it on a work device.` : 'Opens on a work device.'}</span>
          </span>
          {l.needsYou > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{l.needsYou}</span>}
        </div>
      ))}
    </div>
  );
}

const SHOW = 12;
const needsYou = (t: ThreadItem) => t.status === 'needs_permission' || t.openCards > 0;

function ThreadRow({ t, active, onOpen, main }: { t: ThreadItem; active: boolean; onOpen: (t: ThreadItem) => void; main?: boolean }) {
  const running = t.status === 'running' || t.status === 'starting';
  const needs = needsYou(t);
  return (
    <li>
      <button onClick={() => onOpen(t)} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60')}>
        {main ? <Flame className="size-3.5 shrink-0 text-ember" /> : t.pinned ? <Pin className="size-3.5 shrink-0 p-px text-muted-foreground" aria-label="Pinned" /> : <span className="size-3.5 shrink-0" />}
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
        <p className="mt-1 text-sm text-muted-foreground">Pick a thread from the list, or start a new one with the + next to a project.</p>
      </div>
    </div>
  );
}
