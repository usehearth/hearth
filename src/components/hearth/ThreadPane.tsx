// One thread: its own ACP connection (vendored assistant-ui adapter) drawn with assistant-ui's Thread.
// An existing thread opens with session/load and shows its history; a new one opens with session/new + _meta.hearth.
// H4: beside the chat, the thread's living plan (`_hearth/plan`, live on `_hearth/plan_changed`); above the composer,
// the thread's open cards (`_meta.hearth.card`, answered with `_hearth/card/answer`) and this turn's checklist (ACP plan).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AssistantRuntimeProvider, useAui, useAuiState } from '@assistant-ui/react';
import { ChevronDown, Circle, FolderOpen, CircleCheck, CircleDot, ListChecks, Loader2, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react';
import { AcpClient, useAcpPlan, useAcpRuntime, useAcpSessionTitle } from '@/vendor/acp';
import type { AcpWebSocketLike } from '@/vendor/acp/AcpClient';
import { Thread, type ThreadComponents } from '@/components/assistant-ui/elements/thread.aui';
import { CardView } from '@/components/hearth/CardView';
import { Markdown } from '@/components/hearth/Markdown';
import { FilesList, FileView, type FileContent, type FileItem } from '@/components/hearth/FilesPanel';
import { openSocket } from '@/lib/servers';
import { HearthAttachments } from '@/lib/attachments';
import { type Card, type CardAnswer, type CardEntry, type Plan, cardOf, mergeCard, planPref, setPlanPref } from '@/lib/hearth';
import { cn } from '@/lib/utils';

export type ThreadTarget =
  | { kind: 'open'; sessionId: string; cwd: string }
  | { kind: 'new'; cwd: string; meta: Record<string, unknown> };

export interface ThreadEvents {
  onError: (message: string) => void;
  /** The server-side session id, once known (a new thread gets one on its first message). */
  onSession: (sessionId: string) => void;
  /** The server renamed the thread (session_info_update). */
  onTitle: (title: string) => void;
  /** A turn finished: the sidebar may have changed. */
  onTurnEnd: () => void;
}

export function ThreadPane({ url, serverKey, target, events, actionsEl, seed }: {
  url: string; serverKey: string; target: ThreadTarget; events: ThreadEvents;
  /** Text to put in the composer once the thread is open (Continue in Hearth's summary). */
  seed?: string;
  /** Where the thread's header buttons go (the plan toggle). */
  actionsEl?: HTMLElement | null;
}) {
  const client = useMemo(() => new AcpClient({
    url,
    cwd: target.cwd || '/',
    clientInfo: { name: 'hearth', version: '0.1.0' },
    webSocketFactory: (u) => openSocket(u, serverKey) as unknown as AcpWebSocketLike,
    ...(target.kind === 'open' ? { sessionId: target.sessionId } : { newSessionMeta: target.meta }),
  }), [url, serverKey, target]);
  useEffect(() => () => client.dispose(), [client]);
  return <Runtime client={client} events={events} actionsEl={actionsEl} seed={seed} />;
}

/** How long an answered card stays on screen (greyed, with who answered) before it goes. */
const ANSWERED_LINGER_MS = 6000;

interface Extras {
  sessionId?: string;
  supported: boolean;
  cards: Card[];
  answer: (card: Card, a: CardAnswer) => Promise<unknown>;
  plan: Plan | null;
  planLoading: boolean;
  refreshPlan: () => void;
  /** Files the thread made (null until read; filesSupported false on servers without them). */
  files: FileItem[] | null;
  filesSupported: boolean;
  filesLoading: boolean;
  refreshFiles: () => void;
  readFile: (path: string) => Promise<FileContent>;
}

/** The thread's Hearth extras: its cards and its plan, kept live. A server without the extensions gives neither. */
function useThreadExtras(client: AcpClient): Extras {
  const [sessionId, setSessionId] = useState<string | undefined>(client.sessionId);
  const [connected, setConnected] = useState(client.connectionState === 'connected');
  const [supported, setSupported] = useState(true);
  const [cards, setCards] = useState<Card[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [filesSupported, setFilesSupported] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => client.subscribeConnectionChange((s) => { setConnected(s === 'connected'); setSessionId(client.sessionId); }), [client]);

  const linger = useCallback((c: Card) => {
    if (c.status === 'open' || timers.current.has(c.id)) return;
    timers.current.set(c.id, setTimeout(() => { timers.current.delete(c.id); setCards((cs) => cs.filter((x) => x.id !== c.id)); }, ANSWERED_LINGER_MS));
  }, []);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  const unsupported = (e: unknown) => { if ((e as { code?: number })?.code === -32601) setSupported(false); };
  const loadCards = useCallback(() => {
    if (!sessionId || !connected) return;
    client.extRequest<{ cards: CardEntry[] }>('_hearth/cards', { sessionId }).then((r) => {
      // Permission prompts of this thread's own agent show in the chat (ACP request_permission), not as cards here.
      const open = (r.cards ?? []).map((e) => e.card).filter((c) => c.answerable !== 'permission');
      const ids = new Set(open.map((c) => c.id));
      setCards((prev) => [...open, ...prev.filter((c) => c.status !== 'open' && !ids.has(c.id))]);
    }, unsupported);
  }, [client, sessionId, connected]);
  const refreshPlan = useCallback(() => {
    if (!sessionId || !connected) return;
    setPlanLoading(true);
    client.extRequest<Plan>('_hearth/plan', { sessionId })
      .then((p) => setPlan({ path: p?.path ?? null, text: p?.text ?? null, note: p?.note }), (e) => { unsupported(e); setPlan(null); })
      .finally(() => setPlanLoading(false));
  }, [client, sessionId, connected]);

  const refreshFiles = useCallback(() => {
    if (!sessionId || !connected) return;
    setFilesLoading(true);
    client.extRequest<{ files: FileItem[] }>('_hearth/files', { sessionId })
      .then((r) => setFiles(r.files ?? []), (e) => { if ((e as { code?: number })?.code === -32601) setFilesSupported(false); })
      .finally(() => setFilesLoading(false));
  }, [client, sessionId, connected]);
  const readFile = useCallback((path: string) => client.extRequest<FileContent>('_hearth/file', { sessionId: client.sessionId, path }), [client]);

  useEffect(() => { loadCards(); refreshPlan(); refreshFiles(); }, [loadCards, refreshPlan, refreshFiles]);
  useEffect(() => client.subscribeExtNotification((method, params) => {
    const sid = (params as { sessionId?: string })?.sessionId;
    if (method === '_hearth/plan_changed' && sid === client.sessionId) refreshPlan();
    if (method === '_hearth/cards_changed') loadCards();
    if (method === '_hearth/files_changed' && sid === client.sessionId) refreshFiles();
  }), [client, refreshPlan, loadCards, refreshFiles]);
  useEffect(() => client.subscribeSessionUpdate((_sid, update) => {
    const c = cardOf(update);
    if (!c || c.answerable === 'permission') return;
    setCards((cs) => mergeCard(cs, c));
    linger(c);
  }), [client, linger]);

  const answer = useCallback(async (card: Card, a: CardAnswer) => {
    const r = await client.extRequest<{ card: Card }>('_hearth/card/answer', { sessionId: client.sessionId, itemId: card.id, ...a });
    if (r?.card) { setCards((cs) => mergeCard(cs, { ...card, ...r.card })); linger(r.card); }
  }, [client, linger]);

  return { sessionId, supported, cards, answer, plan, planLoading, refreshPlan, files, filesSupported, filesLoading, refreshFiles, readFile };
}

const ExtrasContext = createContext<Extras | null>(null);
const components: ThreadComponents = { AboveComposer: () => <AboveComposer /> };

function Runtime({ client, events, actionsEl, seed }: { client: AcpClient; events: ThreadEvents; actionsEl?: HTMLElement | null; seed?: string }) {
  const ev = useRef(events);
  ev.current = events;
  // Images and text files, as this server takes them (its promptCapabilities); a refused file says why.
  const attachments = useMemo(() => {
    const a = new HearthAttachments(() => {
      const pc = client.agentCapabilities?.promptCapabilities;
      if (!pc) return undefined;
      const h = client.initializeMeta?.hearth;
      const uploads = Array.isArray(h?.extensions) && h.extensions.includes('uploads') ? Number(h.uploadMaxBytes) || 15 * 1024 * 1024 : undefined;
      return { image: !!pc.image, embeddedContext: !!pc.embeddedContext, uploadMaxBytes: uploads };
    });
    const add = a.add.bind(a);
    a.add = async (st) => { try { return await add(st); } catch (e) { ev.current.onError((e as Error).message); throw e; } };
    return a;
  }, [client]);
  const runtime = useAcpRuntime({ client, permissions: 'ask', onError: (e) => ev.current.onError(e.message), adapters: { attachments } });
  useEffect(() => client.subscribeConnectionChange(() => { if (client.sessionId) ev.current.onSession(client.sessionId); }), [client]);
  const extras = useThreadExtras(client);
  // Open or closed, remembered per thread; by default open when the thread has a plan, on a wide enough window.
  const [pref, setPref] = useState(() => planPref(extras.sessionId));
  useEffect(() => { setPref(planPref(extras.sessionId)); }, [extras.sessionId]);
  const wide = useWide();
  const hasPlan = !!extras.plan?.text;
  const planOpen = extras.supported && !!extras.sessionId && (pref ? pref === 'open' : hasPlan && wide);
  const [tab, setTab] = useState<'plan' | 'files'>('plan');
  const setOpen = (v: 'open' | 'closed') => { setPref(v); setPlanPref(extras.sessionId, v); };
  /** The header buttons: open the panel on that tab, or close it when it already shows that tab. */
  const show = (t: 'plan' | 'files') => { if (planOpen && tab === t) setOpen('closed'); else { setTab(t); setOpen('open'); } };
  const nFiles = extras.files?.length ?? 0;
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ExtrasContext.Provider value={extras}>
        <Watch events={ev} />
        {seed && <Seed text={seed} />}
        <div className="flex h-full">
          <div className="relative min-w-0 flex-1">
            <Thread components={components} />
          </div>
          {planOpen && <SidePanel extras={extras} tab={extras.filesSupported ? tab : 'plan'} onTab={setTab} onClose={() => setOpen('closed')} />}
        </div>
        {actionsEl && extras.supported && extras.sessionId && createPortal(
          <>
            {extras.filesSupported && (
              <button onClick={() => show('files')} aria-pressed={planOpen && tab === 'files'} title="Files this thread made"
                className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground', planOpen && tab === 'files' && 'bg-accent text-foreground')}>
                <FolderOpen className="size-4" /><span className="max-sm:sr-only">Files</span>
                {nFiles > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium">{nFiles}</span>}
              </button>
            )}
            <button onClick={() => show('plan')} aria-pressed={planOpen && tab === 'plan'} title={planOpen && tab === 'plan' ? 'Hide the plan' : 'Show the plan'}
              className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground', planOpen && tab === 'plan' && 'bg-accent text-foreground')}>
              {planOpen && tab === 'plan' ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              <span className="max-sm:sr-only">Plan</span>
              {hasPlan && !(planOpen && tab === 'plan') && <span className="size-1.5 rounded-full bg-primary" aria-label="has a plan" />}
            </button>
          </>, actionsEl)}
      </ExtrasContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function useWide() {
  const q = '(min-width: 1100px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return wide;
}

/**
 * Beside the chat: the thread's living plan (the plan file, rendered, updating when the agent changes it) and the
 * files the thread made (artifacts), with a preview.
 */
function SidePanel({ extras, tab, onTab, onClose }: { extras: Extras; tab: 'plan' | 'files'; onTab: (t: 'plan' | 'files') => void; onClose: () => void }) {
  const { plan, planLoading, refreshPlan } = extras;
  const [open, setOpen] = useState<FileItem | null>(null);
  // A file reopens fresh when the agent changes it again.
  const current = open ? extras.files?.find((f) => f.path === open.path) ?? open : null;
  const wideFile = tab === 'files' && !!current;
  return (
    <aside aria-label={tab === 'plan' ? 'Plan' : 'Files'} className={cn(wideFile && 'lg:w-[34rem]', "flex w-[22rem] shrink-0 flex-col border-l bg-sidebar/40 max-lg:w-80 max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full max-md:border-l-0 max-md:bg-background max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]")}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <div role="tablist" className="flex items-center gap-0.5">
          <TabBtn on={tab === 'plan'} onClick={() => onTab('plan')}><ListChecks className="size-4" />Plan</TabBtn>
          {extras.filesSupported && <TabBtn on={tab === 'files'} onClick={() => onTab('files')}><FolderOpen className="size-4" />Files{extras.files?.length ? <span className="text-xs text-muted-foreground">{extras.files.length}</span> : null}</TabBtn>}
        </div>
        {(tab === 'plan' ? planLoading : extras.filesLoading) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-0.5">
          {tab === 'plan' && <button onClick={refreshPlan} title="Read the plan again" aria-label="Read the plan again" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="size-3.5" /></button>}
          <button onClick={onClose} title="Hide the panel" aria-label="Hide the panel" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><PanelRightClose className="size-4" /></button>
        </div>
      </div>
      {tab === 'plan' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {plan?.text ? <Markdown text={plan.text} />
              : <p className="text-sm text-muted-foreground">{plan?.note ?? (planLoading ? 'Reading the plan…' : 'No plan yet.')}</p>}
          </div>
          {plan?.path && <div className="truncate border-t px-4 py-2 font-mono text-[11px] text-muted-foreground" title={plan.path}>{plan.path}</div>}
        </>
      ) : current ? (
        <div className="min-h-0 flex-1"><FileView file={current} read={extras.readFile} onBack={() => setOpen(null)} /></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto"><FilesList files={extras.files} loading={extras.filesLoading} onOpen={setOpen} onRefresh={extras.refreshFiles} /></div>
      )}
    </aside>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick}
      className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm', on ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
      {children}
    </button>
  );
}

/** Above the composer: the thread's open cards, then this turn's checklist. */
function AboveComposer() {
  const x = useContext(ExtrasContext);
  const cards = x?.cards ?? [];
  return (
    <>
      {cards.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="Needs you in this thread">
          {cards.map((c) => <CardView key={c.id} card={c} compact onAnswer={(a) => x!.answer(c, a)} />)}
        </div>
      )}
      <TurnChecklist />
    </>
  );
}

/** The agent's steps for this turn (ACP `plan` updates). Open while it runs; folded to one line afterwards. */
function TurnChecklist() {
  const entries = useAcpPlan();
  const running = useAuiState((s) => s.thread.isRunning);
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => { if (running) setOpen(null); }, [running]);
  if (!entries?.length) return null;
  const done = entries.filter((e) => e.status === 'completed').length;
  const expanded = open ?? running;
  return (
    <div className="rounded-xl border bg-card/60 text-sm">
      <button onClick={() => setOpen(!expanded)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ListChecks className="size-4 text-muted-foreground" />
        <span className="font-medium">{running ? 'Working through' : 'Steps this turn'}</span>
        <span className="text-xs text-muted-foreground">{done}/{entries.length} done</span>
        <ChevronDown className={cn('ml-auto size-3.5 text-muted-foreground transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded && (
        <ul className="space-y-1 px-3 pb-2.5">
          {entries.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              {e.status === 'completed' ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : e.status === 'in_progress' ? <CircleDot className="mt-0.5 size-3.5 shrink-0 text-primary" />
                : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn(e.status === 'completed' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{e.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Puts text in the composer once, after the thread has loaded (Continue in Hearth). */
function Seed({ text }: { text: string }) {
  const aui = useAui();
  const loading = useAuiState((s) => s.thread.isLoading);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || loading) return;
    done.current = true;
    if (!aui.composer.getState().text) aui.composer.setText(`${text}\n\n`);
  }, [loading, aui, text]);
  return null;
}

/** Reports title changes and turn ends from inside the runtime. */
function Watch({ events }: { events: React.RefObject<ThreadEvents> }) {
  const title = useAcpSessionTitle();
  const running = useAuiState((s) => s.thread.isRunning);
  const was = useRef(running);
  useEffect(() => { if (title) events.current.onTitle(title); }, [title, events]);
  useEffect(() => { if (was.current && !running) events.current.onTurnEnd(); was.current = running; }, [running, events]);
  return null;
}
