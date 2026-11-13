// One thread: its own ACP connection (vendored assistant-ui adapter) drawn with assistant-ui's Thread.
// An existing thread opens with session/load and shows its history; a new one opens with session/new + _meta.hearth.
// H4: beside the chat, the thread's living plan (`_hearth/plan`, live on `_hearth/plan_changed`); above the composer,
// the thread's open cards (`_meta.hearth.card`, answered with `_hearth/card/answer`) and this turn's checklist (ACP plan).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AssistantRuntimeProvider, useAuiState } from '@assistant-ui/react';
import { ChevronDown, Circle, FolderOpen, CircleCheck, CircleDot, ListChecks, Loader2, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react';
import { AcpClient, useAcpPlan, useAcpRuntime, useAcpSessionTitle } from '@/vendor/acp';
import type { AcpWebSocketLike } from '@/vendor/acp/AcpClient';
import { Thread, type ThreadComponents } from '@/components/assistant-ui/elements/thread.aui';
import { CardView } from '@/components/hearth/CardView';
import { UsageMeter } from '@/components/hearth/UsageMeter';
import { ComposerBar } from '@/components/hearth/ComposerBar';
import { notify } from '@/lib/notify';
import { MessageActionsContext } from '@/components/hearth/messageActions';
import type { AppendMessage } from '@assistant-ui/react';

const textOf = (content: readonly { type: string; text?: string }[] | undefined) =>
  (content ?? []).map((p) => (p.type === 'text' ? p.text ?? '' : '')).join('').trim();

/** True once the thread has finished opening: session/load answered (so its whole history is shown) and not loading. */
function useAuiStateOf(runtime: { thread: { getState: () => { isLoading: boolean }; subscribe: (cb: () => void) => () => void } }, client: AcpClient) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const check = () => setLoaded(!!client.sessionId && !runtime.thread.getState().isLoading);
    check();
    const a = runtime.thread.subscribe(check);
    const b = client.subscribeConnectionChange(check);
    return () => { a(); b(); };
  }, [runtime, client]);
  return loaded;
}
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
  /** The thread was forked (Edit, Regenerate, Rewind): open the fork, then send or prefill its first message. */
  onFork?: (sessionId: string, title: string, first: FirstMessage) => void;
}

/** What a fork opens with: a message sent at once (Edit, Regenerate) or put in the composer (Rewind). */
export interface FirstMessage { text: string; send: boolean }

export function ThreadPane({ url, serverKey, target, events, actionsEl, first }: {
  url: string; serverKey: string; target: ThreadTarget; events: ThreadEvents; first?: FirstMessage;
  /** Where the thread's header buttons go (the plan toggle). */
  actionsEl?: HTMLElement | null;
}) {
  // A dropped socket reconnects by itself: a fresh connection opens the thread again with session/load, so everything
  // said meanwhile (another window, a turn that kept running on the server) shows up. `gen` makes that new connection.
  const [gen, setGen] = useState(0);
  const [reconnecting, setReconnecting] = useState<boolean | 'stopped'>(false);
  const known = useRef<string | undefined>(target.kind === 'open' ? target.sessionId : undefined);
  const fails = useRef(0);
  const client = useMemo(() => {
    const sid = known.current;
    return new AcpClient({
      url,
      cwd: target.cwd || '/',
      clientInfo: { name: 'hearth', version: '0.1.0' },
      webSocketFactory: (u) => openSocket(u, serverKey) as unknown as AcpWebSocketLike,
      ...(sid ? { sessionId: sid } : target.kind === 'new' ? { newSessionMeta: target.meta } : {}),
    });
  }, [url, serverKey, target, gen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wasUp = false;
    const off = client.subscribeConnectionChange((s) => {
      if (!live) return;
      if (client.sessionId) known.current = client.sessionId;
      if (s === 'connected' && client.sessionId) { wasUp = true; fails.current = 0; setReconnecting(false); }
      if (s === 'disconnected' && known.current && !timer && (wasUp || fails.current > 0)) {
        // Each refused try counts toward the server's bad-key lockout, so stop after a few and offer a button.
        if (fails.current >= GIVE_UP_AFTER) { setReconnecting('stopped'); return; }
        setReconnecting(true);
        const wait = RECONNECT_MS[Math.min(fails.current++, RECONNECT_MS.length - 1)];
        timer = setTimeout(() => { if (live) setGen((g) => g + 1); }, wait);
      }
    });
    return () => { live = false; off(); if (timer) clearTimeout(timer); };
  }, [client]);
  // Back online or back to the window: try now rather than wait out the backoff.
  useEffect(() => {
    if (reconnecting !== true) return;
    const now = () => setGen((g) => g + 1);
    window.addEventListener('online', now);
    window.addEventListener('focus', now);
    return () => { window.removeEventListener('online', now); window.removeEventListener('focus', now); };
  }, [reconnecting]);
  return (
    <div className="relative h-full">
      {reconnecting && (
        <div role="status" className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          {reconnecting === 'stopped'
            ? <>Disconnected.<button onClick={() => { fails.current = 0; setReconnecting(true); setGen((g) => g + 1); }} className="font-medium text-foreground underline-offset-2 hover:underline">Reconnect</button></>
            : <><Loader2 className="size-3 animate-spin" />Reconnecting…</>}
        </div>
      )}
      <Runtime key={gen} client={client} events={events} actionsEl={actionsEl} first={gen === 0 ? first : undefined} />
    </div>
  );
}

const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
const GIVE_UP_AFTER = 6;

/** How long an answered card stays on screen (greyed, with who answered) before it goes. */
const ANSWERED_LINGER_MS = 6000;

interface Extras {
  client: AcpClient;
  onError: (message: string) => void;
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
      // Permission prompts are cards too: during this window's own turn they show in the chat instead (AboveComposer).
      const open = (r.cards ?? []).map((e) => e.card);
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
    if (!c) return;
    setCards((cs) => mergeCard(cs, c));
    linger(c);
  }), [client, linger]);

  const answer = useCallback(async (card: Card, a: CardAnswer) => {
    const r = await client.extRequest<{ card: Card }>('_hearth/card/answer', { sessionId: client.sessionId, itemId: card.id, ...a });
    if (r?.card) { setCards((cs) => mergeCard(cs, { ...card, ...r.card })); linger(r.card); }
  }, [client, linger]);

  return { client, onError: () => {}, sessionId, supported, cards, answer, plan, planLoading, refreshPlan, files, filesSupported, filesLoading, refreshFiles, readFile };
}

const ExtrasContext = createContext<Extras | null>(null);
const components: ThreadComponents = { AboveComposer: () => <AboveComposer />, ComposerExtra: () => <ComposerExtra /> };

/** Beside the attach button: mode, model and usage. */
function ComposerExtra() {
  const x = useContext(ExtrasContext);
  if (!x) return <UsageMeter />;
  return <ComposerBar client={x.client} onError={x.onError} />;
}

function Runtime({ client, events, actionsEl, first }: { client: AcpClient; events: ThreadEvents; actionsEl?: HTMLElement | null; first?: FirstMessage }) {
  const ev = useRef(events);
  ev.current = events;
  // Images and text files, as this server takes them (its promptCapabilities); a refused file says why.
  const runtimeRef = useRef<ReturnType<typeof useAcpRuntime> | null>(null);
  const attachments = useMemo(() => {
    const a = new HearthAttachments(() => {
      const pc = client.agentCapabilities?.promptCapabilities;
      if (!pc) return undefined;
      const h = client.initializeMeta?.hearth;
      const uploads = Array.isArray(h?.extensions) && h.extensions.includes('uploads') ? Number(h.uploadMaxBytes) || 15 * 1024 * 1024 : undefined;
      return { image: !!pc.image, embeddedContext: !!pc.embeddedContext, uploadMaxBytes: uploads };
    }, () => runtimeRef.current?.thread.composer.getState().attachments.filter((x) => x.type === 'image').length ?? 0);
    const add = a.add.bind(a);
    a.add = async (st) => { try { return await add(st); } catch (e) { ev.current.onError((e as Error).message); throw e; } };
    return a;
  }, [client]);
  // Edit, Regenerate and Rewind: the server owns the thread, so each forks it at that turn and opens the fork.
  const fork = useCallback(async (keepTurns: number, text: string, send: boolean, restoreFiles = false) => {
    const ext = client.initializeMeta?.hearth?.extensions;
    if (!Array.isArray(ext) || !ext.includes('fork')) throw new Error("This server can't fork threads.");
    const r = await client.extRequest<{ sessionId: string; title: string }>('_hearth/thread/fork', { sessionId: client.sessionId, keepTurns, restoreFiles });
    ev.current.onFork?.(r.sessionId, r.title, { text, send });
  }, [client]);
  const userTurn = (messageId: string | null, inclusive: boolean) => {
    const msgs = runtimeRef.current?.thread.getState().messages ?? [];
    const i = messageId ? msgs.findIndex((m) => m.id === messageId) : -1;
    return { turn: msgs.slice(0, inclusive ? i + 1 : Math.max(i, 0)).filter((m) => m.role === 'user').length, message: i >= 0 ? msgs[i] : undefined };
  };
  const onEdit = useCallback(async (m: AppendMessage) => {
    const { turn } = userTurn(m.parentId, true);
    await fork(turn, textOf(m.content), true).catch((e) => ev.current.onError((e as Error).message));
  }, [fork]); // eslint-disable-line react-hooks/exhaustive-deps
  const onReload = useCallback(async (parentId: string | null) => {
    const { turn, message } = userTurn(parentId, false);
    if (!message) return;
    await fork(turn, textOf(message.content), true).catch((e) => ev.current.onError((e as Error).message));
  }, [fork]); // eslint-disable-line react-hooks/exhaustive-deps
  const messageActions = useMemo(() => ({
    rewind: async (messageId: string, restoreFiles: boolean) => {
      const { turn, message } = userTurn(messageId, false);
      await fork(turn, message ? textOf(message.content) : '', false, restoreFiles);
    },
  }), [fork]); // eslint-disable-line react-hooks/exhaustive-deps
  const runtime = useAcpRuntime({ client, permissions: 'ask', onError: (e) => ev.current.onError(e.message), adapters: { attachments }, onEdit, onReload });
  runtimeRef.current = runtime;
  // A fork opens with its first message: sent (Edit, Regenerate) or ready in the composer (Rewind).
  const firstDone = useRef(false);
  const loaded = useAuiStateOf(runtime, client);
  useEffect(() => {
    if (!first || firstDone.current || !loaded) return;
    firstDone.current = true;
    if (first.send && first.text.trim()) void runtime.thread.append({ role: 'user', content: [{ type: 'text', text: first.text }] });
    else runtime.thread.composer.setText(first.text);
  }, [first, loaded, runtime]);
  useEffect(() => client.subscribeConnectionChange(() => { if (client.sessionId) ev.current.onSession(client.sessionId); }), [client]);
  const base = useThreadExtras(client);
  const extras = useMemo(() => ({ ...base, onError: (m: string) => ev.current.onError(m) }), [base]);
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
        <MessageActionsContext.Provider value={messageActions}>
        <div className="flex h-full">
          <div className="relative min-w-0 flex-1">
            <Thread components={components} />
          </div>
          {planOpen && <SidePanel extras={extras} tab={extras.filesSupported ? tab : 'plan'} onTab={setTab} onClose={() => setOpen('closed')} />}
        </div>
        </MessageActionsContext.Provider>
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
  // A permission prompt shows in the chat while this window runs the turn; otherwise (another window's turn, after a
  // reload or reconnect) it shows here as a card, with the same answers, Always allow included.
  const running = useAuiState((s) => s.thread.isRunning);
  const cards = (x?.cards ?? []).filter((c) => c.answerable !== 'permission' || !running || c.status !== 'open');
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

/** Reports title changes and turn ends from inside the runtime. */
function Watch({ events }: { events: React.RefObject<ThreadEvents> }) {
  const title = useAcpSessionTitle();
  const running = useAuiState((s) => s.thread.isRunning);
  const was = useRef(running);
  useEffect(() => { if (title) events.current.onTitle(title); }, [title, events]);
  const lastText = useAuiState((s) => {
    const m = s.thread.messages.at(-1);
    if (!m || m.role !== 'assistant') return '';
    return m.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ').trim();
  });
  useEffect(() => {
    if (was.current && !running) {
      events.current.onTurnEnd();
      void notify(title ? `Done · ${title}` : 'Hearth: turn finished', lastText || 'The answer is ready.');
    }
    was.current = running;
  }, [running, events]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
