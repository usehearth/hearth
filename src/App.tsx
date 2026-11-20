import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notify } from '@/lib/notify';
import { assetUrl, hostReady, inVsCode, onHostEvent } from '@/lib/hostBridge';
import { Archive, BellDot, Briefcase, ChevronDown, FolderPlus, History as HistoryIcon, Lock, Menu, Settings as SettingsIcon, ShieldAlert, SlidersHorizontal, Flame, Loader2, MoonStar, Pin, Plus, RefreshCw, Server as ServerIcon, Sun, TriangleAlert, Download, X } from 'lucide-react';
import { useAdminKey } from '@/components/hearth/Admin';
import { errorText } from '@/lib/hearth';
import { isConnectionError, plainError } from '@/lib/errors';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ThreadPane, type Blocked, type FirstMessage, type ThreadTarget } from '@/components/hearth/ThreadPane';
import { AddServer, KeyPrompt } from '@/components/hearth/AddServer';
import { Setup } from '@/components/hearth/Setup';
import { NeedsYou } from '@/components/hearth/NeedsYou';
import { Settings } from '@/components/hearth/Settings';
import { ProjectSettings } from '@/components/hearth/ProjectSettings';
import { HistoryView, ImportedThread, type Continued, type HistoryScope, type ImportedSummary } from '@/components/hearth/History';
import { ImportWizard } from '@/components/hearth/ImportWizard';
import { NewProject, type Made } from '@/components/hearth/NewProject';
import { clientNames } from '@/lib/choices';
import { ArchivedList, SearchResults, SidebarSearch, ThreadMenu, type SearchHit } from '@/components/hearth/ThreadTools';
import type { CardEntry } from '@/lib/hearth';
import { useDirectory, type ClientLine, type ImportedGroup, type ProjectGroup, type ThreadItem } from '@/lib/directory';
import { isDesktop, keyFor, keysReady, useServers } from '@/lib/servers';
import { startSetup, useSetup } from '@/lib/setup';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { recentGroups, setSidebarView, sidebarView } from '@/lib/recent';
import { fullWhen, shortWhen } from '@/lib/dates';

export default function App() {
  const servers = useServers();
  const [serverId, setServerId] = useState<string | undefined>(servers[0]?.id);
  const server = servers.find((s) => s.id === serverId) ?? servers[0];
  const [keyVersion, setKeyVersion] = useState(0);
  const dir = useDirectory(server, keyVersion);
  // `id` keys the open pane (stable for its lifetime); `sessionId` is the server's id once known.
  const [target, setTarget] = useState<{ id: string; sessionId?: string; t: ThreadTarget; title: string; project?: string; client?: string; first?: FirstMessage; admin?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The main pane shows the open thread, or the needs-you view.
  type View = 'thread' | 'needs' | 'settings' | 'project' | 'history' | 'imported' | 'newproject' | 'import';
  const [view, setView] = useState<View>('thread');
  // History: a project's imported conversations (or all of them, to search), and the one open.
  const [historyOf, setHistoryOf] = useState<HistoryScope | null>(null);
  const histKey = historyOf && 'project' in historyOf ? `p:${historyOf.project}` : historyOf && 'group' in historyOf ? `g:${historyOf.group}` : '';
  const [imported, setImported] = useState<ImportedSummary | null>(null);
  const [projectView, setProjectView] = useState<{ slug: string; name: string } | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  // Phones: the sidebar is a drawer, closed whenever something is picked in it.
  const [navOpen, setNavOpen] = useState(false);
  const go = useCallback((v: View) => { setView(v); setNavOpen(false); }, []);
  // Each click on "Import Claude history" starts the wizard afresh (a finished run stays on its Done page otherwise).
  const [importRun, setImportRun] = useState(0);
  const { dark, toggle } = useTheme();
  // Thread management (server extension `threads`): search, the archived list, a menu on each thread.
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [listView, setListView] = useState(sidebarView);
  const threadsExt = dir.state === 'ready' && dir.extensions.includes('threads');
  const menu = threadsExt && dir.state === 'ready' ? (t: ThreadItem) => <ThreadMenu t={t} request={dir.request} onError={setError}
    onChanged={(sessionId, change) => {
      // A deleted or archived thread leaves the list: close it if it's the one open, then refresh the list.
      if (change === 'deleted' || change === 'archived') setTarget((cur) => (cur?.sessionId === sessionId ? null : cur));
      dir.refresh();
    }} /> : undefined;
  // Admin threads (server extension `admin_threads`): this install types in one only with its admin key, pinned on the
  // laptop runner. Every device lists and watches them; only an admin device with that key opens or finishes one.
  const adminExt = dir.state === 'ready' && dir.extensions.includes('admin_threads');
  const adminKey = useAdminKey(dir.state === 'ready' ? dir.request : undefined, adminExt);
  const canSign = adminExt && adminKey.pinned;
  const canOpenAdmin = canSign && dir.state === 'ready' && dir.admin;

  useEffect(() => { if (!serverId && servers[0]) setServerId(servers[0].id); }, [servers, serverId]);
  const setup = useSetup();
  const guided = isDesktop && !inVsCode;
  useEffect(() => { if (guided && !servers.length && !setup?.active) startSetup(); }, [guided, servers.length, setup?.active]);
  // A server just added: once connected, offer the import wizard if it can import and holds no history yet.
  const offerImport = useRef(false);
  useEffect(() => {
    if (!offerImport.current || dir.state !== 'ready') return;
    offerImport.current = false;
    if (!dir.admin || !dir.extensions.includes('import')) return;
    dir.request<{ available: boolean; conversations: number }>('_hearth/import/info').then((i) => { if (i.available && !i.conversations) go('import'); }, () => {});
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  // A notification for each new Needs-you card (when on and this window isn't in front). The first list only seeds.
  const seenCards = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (dir.state !== 'ready') return;
    const ids = new Set(dir.cards.map((e) => e.card.id));
    if (seenCards.current) for (const e of dir.cards) if (!seenCards.current.has(e.card.id)) {
      void notify(`Needs you · ${e.projectName}`, `${e.card.label}: ${e.card.title}`, `card:${e.card.id}`, () => openCard(e));
    }
    seenCards.current = ids;
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
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
    setTarget((cur) => (cur?.sessionId === t.sessionId ? cur : { id: t.sessionId, sessionId: t.sessionId, t: { kind: 'open', sessionId: t.sessionId, cwd: t.cwd }, title: t.kind === 'main' ? 'Main thread' : t.title, project: t.projectName, client: t.client, ...(t.admin ? { admin: true } : {}) }));
  }, []);
  /** A new admin thread; from a blocked thread ("Open in admin") it opens with a draft first message to read and send. */
  const openAdmin = useCallback(async (origin?: { sessionId: string; title: string }, blocked?: Blocked) => {
    if (dir.state !== 'ready') return;
    setError(null);
    try {
      const r = await dir.request<{ sessionId: string; cwd: string; title: string; draft: string | null }>('_hearth/admin/open', origin ? { origin: origin.sessionId, title: `Fix: ${origin.title}`.slice(0, 80), blocked } : { title: 'Admin' });
      setView('thread'); setNavOpen(false);
      setTarget({ id: r.sessionId, sessionId: r.sessionId, t: { kind: 'open', sessionId: r.sessionId, cwd: r.cwd }, title: r.title, project: 'Admin', admin: true, ...(r.draft ? { first: { text: r.draft, send: false } } : {}) });
      dir.refresh(); void adminKey.reload();
    } catch (e) { setError(errorText(e)); }
  }, [dir, adminKey.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const adminOrigin = (sessionId?: string) => !!adminKey.server?.threads.find((t) => t.sessionId === sessionId)?.origin;
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
  const openHistory = useCallback((s: HistoryScope) => { setHistoryOf(s); setView('history'); setNavOpen(false); }, []);
  const openImported = useCallback((s: ImportedSummary) => { setImported(s); setView('imported'); setNavOpen(false); }, []);
  const groupOf = (slug: string) => (dir.state === 'ready' ? dir.groups.find((g) => g.project === slug) : undefined);
  // Continue in Hearth: the server made the thread; open it with the summary in the composer, ready to add to.
  const continued = (c: Continued) => {
    setError(null); setView('thread');
    setTarget({ id: c.sessionId, sessionId: c.sessionId, t: { kind: 'open', sessionId: c.sessionId, cwd: c.cwd }, title: c.title, project: c.projectName, client: groupOf(c.project)?.client, first: { text: `${c.seed}\n\n`, send: false } });
    if (dir.state === 'ready') dir.refresh();
  };
  const made = (m: Made) => {
    setError(m.tools.ok ? null : `Project made, but its tools aren't wired yet (${m.tools.error ?? 'unknown error'}). Finish that on the page.`);
    setView('thread');
    setTarget({ id: m.sessionId, sessionId: m.sessionId, t: { kind: 'open', sessionId: m.sessionId, cwd: m.cwd }, title: 'Main thread', project: m.name });
    if (dir.state === 'ready') dir.refresh();
  };
  const openHit = useCallback((h: SearchHit) => {
    const known = dir.state === 'ready' ? dir.groups.flatMap((g) => [g.main, ...g.threads]).find((t) => t?.sessionId === h.sessionId) : undefined;
    open(known ?? { sessionId: h.sessionId, title: h.title, cwd: '', updatedAt: h.updatedAt, project: h.project, projectName: h.project, kind: 'work', status: null, runnerOnline: null, pinned: false, openCards: 0 });
  }, [dir, open]);
  const refresh = dir.state === 'ready' ? dir.refresh : undefined;
  // VS Code: the editor opens a thread or puts a selection in the composer (packages/vscode).
  const [insert, setInsert] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    const off = onHostEvent((e) => {
      if (e.type === 'hearth.openThread') setTarget({ id: e.sessionId, sessionId: e.sessionId, t: { kind: 'open', sessionId: e.sessionId, cwd: '' }, title: 'Thread' });
      else setInsert((cur) => ({ text: e.text, n: (cur?.n ?? 0) + 1 }));
    });
    hostReady();
    return off;
  }, []);
  const events = useMemo(() => ({
    onError: (m: string) => { if (m) setError(plainError(m)); },
    // The thread is connected again: a message about the dropped connection is no longer true.
    onRecovered: () => setError((e) => (e && isConnectionError(e) ? null : e)),
    onSession: (sessionId: string) => setTarget((t) => {
      if (!t || t.sessionId === sessionId) return t;
      refresh?.(); // a new thread now exists on the server
      return { ...t, sessionId };
    }),
    onTitle: (title: string) => setTarget((t) => (t && t.title !== title && t.title !== 'Main thread' ? { ...t, title } : t)),
    onTurnEnd: () => refresh?.(),
    // Edit, Regenerate, Rewind: open the fork the server made.
    onFork: (sessionId: string, title: string, first: FirstMessage) => {
      setTarget((t) => ({ id: sessionId, sessionId, t: { kind: 'open', sessionId, cwd: t?.t.cwd ?? '' }, title, project: t?.project, client: t?.client, first }));
      refresh?.();
    },
  }), [refresh]);

  // First run on the desktop: the guided setup (docs/setup-guide.md). The web build and VS Code keep the plain form.
  if (guided && !adding && (setup?.active || !servers.length)) {
    return <Setup onDone={(id) => { offerImport.current = true; setServerId(id); setTarget(null); setKeyVersion((v) => v + 1); }} />;
  }
  if (!servers.length || adding) {
    return <AddServer first={!servers.length} onDone={(id) => { offerImport.current = true; setAdding(false); setServerId(id); setTarget(null); setKeyVersion((v) => v + 1); }} onCancel={servers.length ? () => setAdding(false) : undefined} />;
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
            <img src={assetUrl('logo.svg')} alt="" className="size-7 rounded-lg shadow-sm" />
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
              title={dir.cardsStale ? "Couldn't refresh just now: this may be out of date." : undefined}
              className={cn('mx-3 mb-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-sidebar-accent', view === 'needs' && 'bg-sidebar-accent font-medium')}>
              <BellDot className={cn('size-4', dir.cards.length ? 'text-primary' : 'text-muted-foreground')} />
              <span>Needs you{dir.cardsStale && <span className="ml-1 text-[11px] text-muted-foreground">(may be out of date)</span>}</span>
              {dir.cards.length > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{dir.cards.length}</span>}
              {dir.cards.length === 0 && dir.clients.some((c) => c.needsYou > 0) && <span className="ml-auto text-[11px] text-muted-foreground">client work waits</span>}
            </button>
          )}
          {threadsExt && <SidebarSearch query={query} history={dir.state === 'ready' && dir.extensions.includes('history')} onQuery={(q) => { setQuery(q); if (q) setShowArchived(false); }} />}
          {/* The search box covers imported history too; this row is only for a server without thread search. */}
          {dir.state === 'ready' && !threadsExt && dir.extensions.includes('history') && (
            <button onClick={() => openHistory({})} aria-current={view === 'history' && !histKey ? 'page' : undefined}
              className={cn('mx-3 mb-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-sidebar-accent', view === 'history' && !histKey && 'bg-sidebar-accent font-medium')}>
              <HistoryIcon className="size-4 text-muted-foreground" /><span>Search history</span>
            </button>
          )}
          {dir.state === 'ready' && dir.admin && dir.extensions.includes('import') && (
            <button onClick={() => { setImportRun((n) => n + 1); go('import'); }} aria-current={view === 'import' ? 'page' : undefined}
              className={cn('mx-3 mb-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-sidebar-accent', view === 'import' && 'bg-sidebar-accent font-medium')}>
              <Download className="size-4 text-muted-foreground" /><span>Import Claude history</span>
            </button>
          )}
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {dir.state === 'connecting' && <SidebarSkeleton />}
            {dir.state === 'no-key' && server && <KeyPrompt server={server} onSaved={() => setKeyVersion((v) => v + 1)} />}
            {dir.state === 'error' && (
              <div className="mx-1 mt-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="size-4" />Not connected</div>
                <p className="mt-1 text-muted-foreground">{dir.message}</p>
                {/* Refused while the server is up: the key is the problem, so ask for one. Otherwise it keeps trying. */}
                {dir.refused && server ? <KeyPrompt server={server} onSaved={() => setKeyVersion((v) => v + 1)} /> : (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={dir.retry}><RefreshCw className="size-3.5" />{dir.retrying ? 'Try now' : 'Retry'}</Button>
                    {server && <KeyPrompt compact server={server} onSaved={() => setKeyVersion((v) => v + 1)} />}
                  </div>
                )}
              </div>
            )}
            {dir.state === 'ready' && threadsExt && query && <SearchResults query={query} request={dir.request} onOpen={openHit} history={dir.extensions.includes('history')}
              projectName={(slug) => groupOf(slug)?.name ?? slug} onOpenImported={openImported} />}
            {dir.state === 'ready' && threadsExt && !query && showArchived && (
              <>
                <div className="flex items-center justify-between px-2 pt-2 pb-1">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Archived</span>
                  <button onClick={() => setShowArchived(false)} className="rounded px-1.5 text-[12px] text-muted-foreground hover:text-foreground">Back</button>
                </div>
                <ArchivedList request={dir.request} onOpen={open} onError={setError} />
              </>
            )}
            {dir.state === 'ready' && !(threadsExt && (query || showArchived)) && (
              <>
                <div className="flex items-center justify-between px-2 pt-2 pb-1">
                  <div role="tablist" aria-label="List threads by" className="flex items-center gap-0.5 rounded-md bg-sidebar-accent/50 p-0.5">
                    {(['projects', 'recent'] as const).map((v) => (
                      <button key={v} role="tab" aria-selected={listView === v} onClick={() => { setListView(v); setSidebarView(v); }}
                        className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider', listView === v ? 'bg-sidebar text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
                        {v === 'projects' ? 'Projects' : 'Recent'}
                      </button>
                    ))}
                  </div>
                  <span className="flex items-center gap-0.5">
                    {dir.admin && dir.extensions.includes('new_project') && <IconBtn label="New project" onClick={() => go('newproject')} className={view === 'newproject' ? 'bg-sidebar-accent text-foreground' : undefined}><FolderPlus className="size-3.5" /></IconBtn>}
                    <IconBtn label="Refresh" onClick={dir.refresh}><RefreshCw className="size-3.5" /></IconBtn>
                  </span>
                </div>
                {dir.groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No threads on this server yet.</p>}
                {listView === 'recent' ? (
                  <>
                    <RecentList groups={dir.groups} admin={canOpenAdmin} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} menu={menu} />
                    {!dir.workDevice && <ClientsSection groups={[]} lines={dir.clients} workDevice={false} render={() => null} />}
                  </>
                ) : <>
                <AdminSection group={dir.groups.find(isAdminGroup)} canOpen={canOpenAdmin} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} onNew={() => void openAdmin()} menu={menu} />
                {dir.groups.filter((g) => !g.client && !isAdminGroup(g)).map((g) => (
                  <ProjectSection key={g.project} g={g} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} onNew={() => newThread(g)} menu={menu}
                    onSettings={dir.extensions.includes('project') ? () => { setProjectView({ slug: g.project, name: g.name }); go('project'); } : undefined}
                    settingsOpen={view === 'project' && projectView?.slug === g.project} onHistory={() => openHistory({ project: g.project, name: g.name })} historyOpen={(view === 'history' || view === 'imported') && histKey === `p:${g.project}`} />
                ))}
                <ClientsSection groups={dir.groups.filter((g) => !!g.client)} lines={dir.clients} workDevice={dir.workDevice}
                  render={(g) => (
                    <ProjectSection key={g.project} g={g} activeId={view === 'thread' ? target?.sessionId : undefined} onOpen={open} onNew={() => newThread(g)} menu={menu}
                      onSettings={dir.extensions.includes('project') ? () => { setProjectView({ slug: g.project, name: g.name }); go('project'); } : undefined}
                      settingsOpen={view === 'project' && projectView?.slug === g.project} onHistory={() => openHistory({ project: g.project, name: g.name })} historyOpen={(view === 'history' || view === 'imported') && histKey === `p:${g.project}`} />
                  )} />
                <ImportedSection groups={dir.importedGroups} active={(view === 'history' || view === 'imported') ? histKey : ''} onOpen={(g) => openHistory({ group: g.group, name: g.group, client: g.client })} />
                </>}
                {/* The list stops after a few pages so a big server opens fast; older threads are a click away, not hidden. */}
                {dir.more && dir.loadMore && (
                  <button onClick={dir.loadMore} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground">
                    <HistoryIcon className="size-3.5" />Load older threads
                  </button>
                )}
                {threadsExt && (
                  <button onClick={() => setShowArchived(true)} className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground">
                    <Archive className="size-3.5" />Archived threads
                  </button>
                )}
              </>
            )}
          </nav>
          <div className="border-t border-sidebar-border px-4 py-2.5 text-[11px] text-muted-foreground">
            {dir.state === 'ready'
              ? (dir.reconnecting
                ? (dir.note ? (
                  <>
                    <span role="status">{dir.note}{dir.tryNow && <> <button onClick={dir.tryNow} className="font-medium text-foreground underline-offset-2 hover:underline">Try now</button></>}</span>
                    {/* It may be the key (a server that doesn't say why it refuses): a new one can go in from here. */}
                    {server && <div className="mt-1.5"><KeyPrompt compact server={server} onSaved={() => setKeyVersion((v) => v + 1)} /></div>}
                  </>
                ) : 'Reconnecting…')
                : <>Connected to {dir.agent}. Chats live on the server.</>)
              : 'Chats live on the server, not this device.'}
          </div>
        </aside>

        {/* Main: the open thread */}
        <main className="flex min-w-0 flex-1 flex-col pb-safe">
          <header className="flex shrink-0 items-center gap-2 border-b px-5 pt-safe max-md:px-3 [&>*]:my-auto" style={{ minHeight: 'calc(3rem + env(safe-area-inset-top))' }}>
            <button onClick={() => setNavOpen(true)} aria-label="Open threads" className="relative -ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden">
              <Menu className="size-5" />
              {dir.state === 'ready' && dir.cards.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" aria-label="Something needs you" />}
            </button>
            {view === 'import' ? <span className="text-sm font-medium">Import Claude history</span> : view === 'newproject' ? <span className="text-sm font-medium">New project</span> : view === 'history' ? <span className="truncate text-sm font-medium">{historyOf && 'name' in historyOf ? <>{historyOf.name}<span className="text-muted-foreground"> · History</span></> : 'Imported history'}</span> : view === 'imported' && imported ? <><span className="truncate text-sm font-medium">{imported.title}</span><span className="shrink-0 text-sm text-muted-foreground">· Imported</span></> : view === 'project' && projectView ? <><span className="truncate text-sm font-medium">{projectView.name}</span><span className="text-sm text-muted-foreground">· Project settings</span></> : view === 'settings' ? <span className="text-sm font-medium">Settings</span> : view === 'needs' ? <span className="text-sm font-medium">Needs you</span> : target ? (
              <>
                <span className="truncate text-sm font-medium">{target.title}</span>
                {target.project && <span className="truncate text-sm text-muted-foreground">· {target.project}</span>}
              </>
            ) : <span className="text-sm text-muted-foreground">Pick a thread</span>}
            <div ref={setActionsEl} className={cn('ml-auto flex items-center gap-1', view !== 'thread' && 'hidden')} />
          </header>
          {view === 'imported' && imported?.client && (
            <div className="flex items-center gap-2 border-b bg-warning/10 px-5 py-1.5 text-xs text-warning-text max-md:px-3" role="note">
              <Lock className="size-3.5 shrink-0" />
              <span><span className="font-semibold">Client conversation.</span> Stored on your server, encrypted at rest.</span>
            </div>
          )}
          {view === 'thread' && target?.client && (
            <div className="flex items-center gap-2 border-b bg-warning/10 px-5 py-1.5 text-xs text-warning-text max-md:px-3" role="note">
              <Lock className="size-3.5 shrink-0" />
              <span><span className="font-semibold">Client: {target.client}.</span> Content stays on the work machine; the server keeps only summaries.</span>
            </div>
          )}
          {error && (
            <div data-testid="error-banner" className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /><span className="min-w-0 flex-1 text-foreground/90">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss" title="Dismiss" className="-my-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>
            </div>
          )}
          {view === 'settings' && (
            <div className="min-h-0 flex-1">
              <Settings servers={servers} server={server} dir={dir} onAdd={() => setAdding(true)}
                onUse={(id) => { setServerId(id); setTarget(null); setView('thread'); }} onKeyChanged={() => setKeyVersion((v) => v + 1)} />
            </div>
          )}
          {view === 'project' && projectView && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><ProjectSettings project={projectView.slug} request={dir.request} extensions={dir.extensions} /></div>
          )}
          {view === 'history' && historyOf && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><HistoryView request={dir.request} scope={historyOf} onOpen={openImported} /></div>
          )}
          {view === 'imported' && imported && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><ImportedThread key={imported.id} request={dir.request} summary={imported} onContinue={continued} /></div>
          )}
          {view === 'import' && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><ImportWizard key={importRun} request={dir.request} serverName={server?.name ?? 'your server'} admin={dir.admin}
              onDone={(p) => { dir.refresh(); if (p) openHistory({ project: p.slug, name: p.name }); else setView('thread'); }} /></div>
          )}
          {view === 'newproject' && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><NewProject request={dir.request} clients={clientNames(dir.groups, dir.clients)} onDone={made} /></div>
          )}
          {view === 'needs' && dir.state === 'ready' && (
            <div className="min-h-0 flex-1"><NeedsYou cards={dir.cards} onAnswer={dir.answer} onOpen={openCard}
              onOpenAdmin={canOpenAdmin ? (e) => { if (!groupOf(e.project)?.client && e.project !== 'admin') void openAdmin({ sessionId: e.sessionId, title: e.title }, { tool: e.card.toolCall?.title, reason: e.card.why || e.card.title }); } : undefined}
              adminRequest={adminExt ? dir.request : undefined}
              onOpenThread={(sessionId, title) => open({ sessionId, title, cwd: '', updatedAt: null, project: 'admin', projectName: 'Admin', kind: 'work', status: null, runnerOnline: null, pinned: false, openCards: 0, admin: true })} /></div>
          )}
          {/* The open thread stays mounted behind the needs-you view, so going back keeps its place. */}
          <div className={cn('min-h-0 flex-1', view !== 'thread' && 'hidden')}>
            {target && server && key
              ? <ThreadPane key={target.id} url={server.url} serverKey={key} target={target.t} events={events} actionsEl={actionsEl} first={target.first} insert={insert}
                  admin={target.admin ? { canSign, origin: adminOrigin(target.sessionId), title: target.title, onFinished: () => { refresh?.(); void adminKey.reload(); setTarget(null); } } : undefined}
                  onOpenAdmin={canOpenAdmin && !target.admin && !target.client && target.sessionId ? (b) => void openAdmin({ sessionId: target.sessionId!, title: target.title }, b) : undefined} />
              : <Welcome />}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function ProjectSection({ g, activeId, onOpen, onNew, onSettings, settingsOpen, menu, onHistory, historyOpen }: { g: ProjectGroup; activeId?: string; onOpen: (t: ThreadItem) => void; onNew: () => void; onSettings?: () => void; settingsOpen?: boolean; menu?: (t: ThreadItem) => React.ReactNode; onHistory?: () => void; historyOpen?: boolean }) {
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
        {/* Always shown: on hover only, it was easy to miss. */}
        <IconBtn label={`New thread in ${g.name}`} onClick={onNew}><Plus className="size-3.5" /></IconBtn>
      </div>
      {openSec && (
        <ul className="ml-2 border-l border-sidebar-border pl-1.5">
          {g.main && <ThreadRow t={g.main} active={activeId === g.main.sessionId} onOpen={onOpen} main />}
          {shown.map((t) => <ThreadRow key={t.sessionId} t={t} active={activeId === t.sessionId} onOpen={onOpen} menu={menu} />)}
          {!!g.imported && onHistory && (
            <li>
              <button onClick={onHistory} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                historyOpen ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60')}>
                <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">History</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{g.imported}</span>
              </button>
            </li>
          )}
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

/** Recent: every thread, newest first, in time groups (lib/recent.ts), with its project beside it. */
function RecentList({ groups, admin, activeId, onOpen, menu }: { groups: ProjectGroup[]; /** This device may open admin threads. */ admin: boolean; activeId?: string; onOpen: (t: ThreadItem) => void; menu?: (t: ThreadItem) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const sections = useMemo(() => recentGroups(groups, new Date(), { admin }), [groups, admin]);
  let left = all ? Infinity : 40;
  return (
    <div className="mt-1">
      {sections.map((g) => {
        if (left <= 0) return null;
        const shown = g.items.slice(0, left);
        left -= shown.length;
        return (
          <div key={g.label} className="mt-2 first:mt-0" aria-label={g.label}>
            <div className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground">{g.label}</div>
            <ul>{shown.map((t) => <ThreadRow key={t.sessionId} t={t} active={activeId === t.sessionId} onOpen={onOpen} menu={t.kind === 'main' ? undefined : menu} main={t.kind === 'main'} project />)}</ul>
          </div>
        );
      })}
      {!all && sections.reduce((n, g) => n + g.items.length, 0) > 40 && (
        <button onClick={() => setAll(true)} className="mt-1 w-full rounded-lg px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground">Show all</button>
      )}
    </div>
  );
}

const isAdminGroup = (g: ProjectGroup) => [g.main, ...g.threads].some((t) => t?.admin);

/**
 * Admin threads, first in the list: they run as you on the laptop with no project walls (see Settings > Admin). Every
 * device sees them; only this install, with its pinned admin key, starts one or types in one.
 */
function AdminSection({ group: g, canOpen, activeId, onOpen, onNew, menu }: { group?: ProjectGroup; canOpen: boolean; activeId?: string; onOpen: (t: ThreadItem) => void; onNew: () => void; menu?: (t: ThreadItem) => React.ReactNode }) {
  if (!g && !canOpen) return null;
  const threads = g ? [...(g.main ? [g.main] : []), ...g.threads].sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)) : [];
  return (
    <div className="mt-1" aria-label="Admin">
      <div className="group flex items-center rounded-lg pr-1 hover:bg-sidebar-accent/60">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-[13px] font-semibold"><ShieldAlert className="size-3.5 shrink-0 text-admin" />Admin</span>
        {canOpen && <IconBtn label="New admin thread" onClick={onNew}><Plus className="size-3.5" /></IconBtn>}
      </div>
      <ul className="ml-2 border-l border-admin/30 pl-1.5">
        {threads.slice(0, SHOW).map((t) => <ThreadRow key={t.sessionId} t={t} active={activeId === t.sessionId} onOpen={onOpen} menu={menu} />)}
        {!threads.length && <li className="px-2 py-1 text-[12px] text-muted-foreground">Runs as you on the laptop. No project walls; hard lines and an audit.</li>}
      </ul>
    </div>
  );
}

/** Imported Claude Code conversations from folders that aren't Hearth projects, one row per folder (group). */
function ImportedSection({ groups, active, onOpen }: { groups: ImportedGroup[]; active: string; onOpen: (g: ImportedGroup) => void }) {
  if (!groups.length) return null;
  return (
    <div className="mt-3" aria-label="Imported">
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <HistoryIcon className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Imported (Claude Code)</span>
      </div>
      <ul>
        {groups.map((g) => (
          <li key={`${g.client}:${g.group}`}>
            <button onClick={() => onOpen(g)} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
              active === `g:${g.group}` ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60')}>
              {g.client ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Client" /> : <span className="size-3.5 shrink-0" />}
              <span className="truncate">{g.group}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{g.count}</span>
            </button>
          </li>
        ))}
      </ul>
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

const SHOW = 6;
const needsYou = (t: ThreadItem) => t.status === 'needs_permission' || t.openCards > 0;

function ThreadRow({ t, active, onOpen, main, menu, project }: { t: ThreadItem; active: boolean; onOpen: (t: ThreadItem) => void; main?: boolean; menu?: (t: ThreadItem) => React.ReactNode; /** Recent view: the project's name beside the title. */ project?: boolean }) {
  const running = t.status === 'running' || t.status === 'starting';
  const needs = needsYou(t);
  const name = main || t.kind === 'main' ? 'Main thread' : t.title;
  const when = shortWhen(t.updatedAt);
  const tip = [name, project ? t.projectName : null, project && t.client ? `client ${t.client}` : null, when ? `last active ${when}` : null, needs ? 'needs you' : null].filter(Boolean).join(' · ');
  return (
    <li className="group/row relative">
      <button onClick={() => onOpen(t)} title={tip} aria-label={tip} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        menu && !main && 'pr-8',
        active ? 'bg-sidebar-accent font-medium text-foreground' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/60')}>
        {project && t.client ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={`Client: ${t.client}`} /> : main ? <Flame className="size-3.5 shrink-0 text-ember" /> : t.pinned ? <Pin className="size-3.5 shrink-0 p-px text-muted-foreground" aria-label="Pinned" /> : <span className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{name}</span>
        {project && <span className="ml-auto max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground" title={fullWhen(t.updatedAt)}>{t.projectName}</span>}
        {needs && <span className={cn('size-2 shrink-0 rounded-full bg-primary', !project && 'ml-auto')} />}
        {running && !needs && <Loader2 className={cn('size-3 shrink-0 animate-spin text-muted-foreground', !project && 'ml-auto')} />}
      </button>
      {menu && !main && <div className="absolute top-1/2 right-1 -translate-y-1/2">{menu(t)}</div>}
    </li>
  );
}

function StatusDot({ state }: { state: string }) {
  const c = state === 'ready' ? 'bg-success' : state === 'error' || state === 'no-key' ? 'bg-destructive' : 'bg-warning animate-pulse';
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
        <img src={assetUrl('logo.svg')} alt="" className="mx-auto size-14 rounded-2xl shadow-md" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Your AI, at home</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a thread from the list, or start a new one with the + next to a project.</p>
      </div>
    </div>
  );
}
