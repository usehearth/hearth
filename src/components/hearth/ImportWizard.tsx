// "Bring everything from Claude" (docs/import.md): one flow for Claude Code conversations, claude.ai chats and
// memories, and skills, subagents, slash commands, output styles and plugins.
// Find (automatic: every Claude Code home on this computer, plus the claude.ai export added as the person has it)
// -> one button, with the suggestions already applied (a project per repo or folder, client tags, skills by where they
// came from) -> the receipt the server counted from what it stored. Reviewing the suggestions is a second, optional
// path. Nothing is ever removed from Claude, from this computer or from the export. Engine: src/lib/importer.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, CircleAlert, FileArchive, FolderOpen, HardDrive, Loader2, Lock, Puzzle, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { field } from '@/components/ui/field';
import { ImportReceipt } from '@/components/hearth/ImportReceipt';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';
import { readExports, type ChatExport, type ExportFile } from '@/lib/claudeai';
import { filesFromDrop, filesFromInput } from '@/lib/dropfiles';
import {
  applyPlaceDecisions, bringAcross, canScanThisMachine, configGroup, dateRange, defaultChoices, gather, homeStats, homeWords, leftOutFrom, localSources, previewOf, readConfig, rememberOf, scanLocal,
  type Choice, type ConfigItem, type Decisions, type Gathered, type LocalSource, type LocalUnit, type Odd, type Preview, type Proposal, type RunProgress,
} from '@/lib/importer';
import { clientMatcher, holdBack, secretLines } from '@/lib/secrets';
import { oneLine, type Receipt } from '@/lib/receipt';
import { setImportSnapshot, type ImportSnapshot } from '@/lib/importState';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type Phase = 'finding' | 'ready' | 'review' | 'importing' | 'done';
const STEPS = [{ id: 'find', label: 'Find' }, { id: 'bring', label: 'Bring across' }, { id: 'receipt', label: 'Receipt' }] as const;
const n = (x: number) => x.toLocaleString('en-GB');
const count = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const mb = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : `${Math.max(0.1, b / (1 << 20)).toFixed(1)} MB`);
const when = (ms: number | null | undefined) => {
  if (!ms) return null;
  const d = new Date(ms), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? `today ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};
const inputCls = 'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/40';

interface Info { available: boolean; conversations: number; clientTerms?: string[]; hub?: boolean; lastReceipt?: { runId: number; at: string } | null;
  /** The server counts a receipt and takes skills and the like in the same run (older servers don't). */
  receipts?: boolean;
  /** What earlier imports left out or brought anyway: this run starts from the same choices. */
  decisions?: Decisions }

export function ImportWizard({ request, serverName, admin, part, onDone, setup }: {
  request: Request; serverName: string; admin: boolean;
  /** Open at a part of the flow ("skills": from Settings, Extensions). */
  part?: 'skills';
  onDone: (project?: { slug: string; name: string }) => void;
  /** Opened as a step of first-run setup: skip it, or carry on once the receipt is in. */
  setup?: { onSkip: () => void; onContinue: (summary: string) => void };
}) {
  const [phase, setPhase] = useState<Phase>('finding');
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sources, setSources] = useState<LocalSource[] | null>(canScanThisMachine ? null : []);
  const [scan, setScan] = useState<{ home: string; units: LocalUnit[]; odd?: Odd[] } | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [exports, setExports] = useState<ChatExport[]>([]);
  const [reading, setReading] = useState(false);
  const [leftOutSources, setLeftOutSources] = useState<Set<string>>(new Set());
  const [leftOutGroups, setLeftOutGroups] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Record<string, string>>({});
  // Single skills and the like left out, and held-back or not-loadable ones brought anyway (their keys).
  const [leftOutItems, setLeftOutItems] = useState<Set<string>>(new Set());
  const [bring, setBring] = useState<Set<string>>(new Set());
  const since = useMemo(() => leftOutFrom(info?.decisions).since, [info?.decisions]);
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [planning, setPlanning] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [pool, setPool] = useState('');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  /** An older server answers with no receipt: what it said instead. */
  const [plain, setPlain] = useState<string | null>(null);
  /** The server restarted mid-import (the run lived in its memory): how many conversations arrived before it did. */
  const [lost, setLost] = useState<{ committed: number } | null>(null);
  /** "Run it again": look again (a new plan), then bring everything across as soon as the plan is ready. */
  const [rerun, setRerun] = useState(0);
  const [againPending, setAgainPending] = useState(false);
  const [drag, setDrag] = useState(false);
  const stopped = useRef(false);
  const zipIn = useRef<HTMLInputElement>(null);
  const dirIn = useRef<HTMLInputElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const finding = phase === 'finding' || phase === 'ready' || phase === 'review';

  // 1. What this server holds, and what is on this computer: read it all straight away (read-only).
  useEffect(() => {
    if (!admin) return;
    request<Info>('_hearth/import/info').then((i) => {
      // Start from what was left out (or brought anyway) last time: the same things stay out until changed.
      const d = leftOutFrom(i.decisions);
      setLeftOutSources(d.sources); setLeftOutGroups(d.configGroups); setLeftOutItems(d.items); setBring(d.bring);
      setInfo(i);
    }, (e) => setErr(errorText(e)));
    if (!canScanThisMachine) return;
    let live = true;
    (async () => {
      try {
        const src = await localSources();
        if (!live) return;
        setSources(src);
        const conv = src.filter((s) => s.conversations > 0).map((s) => s.path);
        setScanning({ done: 0, total: src.reduce((t, s) => t + s.conversations, 0) });
        const sc = conv.length ? await scanLocal(conv, (done, total) => live && setScanning({ done, total })) : { home: '', units: [], odd: [] };
        if (!live) return;
        const repos = [...new Set(sc.units.map((u) => u.repo).filter((r): r is string => !!r))];
        const cfg = await readConfig(src.filter((s) => s.kind === 'claude-code' && s.homePath).map((s) => s.homePath!), repos);
        if (!live) return;
        setScan(sc); setConfig(cfg);
      } catch (e) { if (live) { setErr(errorText(e)); setScan({ home: '', units: [], odd: [] }); } } finally { if (live) setScanning(null); }
    })();
    return () => { live = false; };
  }, [request, admin]);

  // 2. Everything found -> one inventory -> the server's suggestions. Again whenever something is added or left out.
  const ready = !!info?.available && (!canScanThisMachine || scan !== null);
  useEffect(() => {
    if (!ready || !finding) return;
    const g = gather({ sources: sources ?? [], scan, config, exports, clientTerms: info?.clientTerms ?? [], leftOut: { sources: leftOutSources, configGroups: leftOutGroups, items: leftOutItems, bring, since } });
    setGathered(g);
    if (!g.inventory.items.length) { setPreview(null); setPhase('ready'); return; }
    let live = true;
    setPlanning(true);
    previewOf(request, [...g.units.values()].map((v) => v.unit), scan?.home ?? '', g.inventory).then((p) => {
      if (!live) return;
      setPreview(p);
      // Keep the person's own changes for folders that are still there; suggestions for the rest.
      setChoices((cur) => { const d = applyPlaceDecisions(defaultChoices(p), info?.decisions); for (const k of Object.keys(d)) if (cur[k]) d[k] = cur[k]; return d; });
      setPool((cur) => cur || p.defaultPool);
      setPhase((ph) => (ph === 'finding' ? 'ready' : ph));
    }, (e) => live && setErr(errorText(e))).finally(() => live && setPlanning(false));
    return () => { live = false; };
  }, [ready, sources, scan, config, exports, leftOutSources, leftOutGroups, leftOutItems, bring, info?.clientTerms, rerun]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (againPending && phase === 'ready' && preview && !planning) { setAgainPending(false); void go(); } }, [againPending, phase, preview, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (part === 'skills' && phase === 'ready') skillsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [part, phase]);

  // The claude.ai export, as the person has it: zips, a folder, or both. Each addition re-reads everything given.
  const addFiles = useCallback(async (more: ExportFile[]) => {
    if (!more.length) return;
    setErr(null); setReading(true);
    const all = [...files.filter((f) => !more.some((m) => m.path === f.path)), ...more];
    try { const r = await readExports(all); setFiles(all); setExports(r.exports); if (r.problems.length) setErr(r.problems.join(' ')); }
    catch (e) { setErr(errorText(e)); } finally { setReading(false); }
  }, [files]);

  const go = async () => {
    if (!gathered || (!preview && gathered.inventory.items.length)) return;
    setErr(null); setPhase('importing'); stopped.current = false;
    try {
      const p = preview ?? await previewOf(request, [], scan?.home ?? '', gathered.inventory);
      const remember = rememberOf({ decisions: info?.decisions, leftOut: { sources: leftOutSources, configGroups: leftOutGroups, items: leftOutItems, bring },
        sourceIds: [...(sources ?? []).map((x) => x.path), ...exports.map((x) => `claude-ai:${x.account}`)], choices, configKeys: config.map((c) => c.key), groups: [...new Set(config.map(configGroup))] });
      const r = await bringAcross({ request, preview: p, choices, pool, gathered, scopes, onProgress: setProgress, stop: () => stopped.current, receipts: info?.receipts === true, remember });
      setReceipt(r.receipt); setCreated(r.begun.created); setLost(r.runGone ?? null);
      if (r.runGone) { setPhase('done'); return; }
      if (!r.receipt) setPlain(`Imported ${n(r.report?.uploaded ?? 0)} conversations${r.begun.unchanged ? `; ${n(r.begun.unchanged)} were already here` : ''}. This server is older: it can't count a receipt, and skills and the like need it updated. Update Hearth Server, then run this again: nothing will be sent twice.`);
      setPhase('done');
    } catch (e) { setErr(errorText(e)); setPhase('ready'); }
  };

  // What the guide may read about all this (src/lib/importState.ts).
  const homes = sources ?? [];
  useEffect(() => {
    const items = gathered?.inventory.items ?? [];
    const cfgItems = items.filter((i) => ['skill', 'agent', 'command', 'output_style', 'hook'].includes(i.kind) || (i.kind === 'other' && i.source !== '' && !i.source.startsWith('claude-ai:')));
    const s: ImportSnapshot = {
      phase: !admin ? 'not-admin' : info && !info.available ? 'no-store' : phase === 'importing' ? 'importing' : phase,
      homes: homes.map((h) => { const w = homeWords(h); return { title: w.title, account: w.who, profiles: w.profiles, holds: w.holds, lastUsed: when(h.lastUsed), included: !leftOutSources.has(h.path) }; }),
      claudeAi: exports.map((x) => ({ account: x.label, chats: x.units.length, emptyChats: x.skipped, memories: x.memories.length, cantKeepYet: x.notKept.filter((k) => k.reason === 'unsupported').length, addedFrom: x.inputs, included: !leftOutSources.has(`claude-ai:${x.account}`) })),
      extensions: gathered ? { toBring: gathered.config.length, heldForSecret: cfgItems.filter((i) => i.reason === 'secret').length, heldForClient: cfgItems.filter((i) => i.reason === 'client').length, unreadable: cfgItems.filter((i) => i.reason === 'unreadable').length } : null,
      plan: preview ? planOf(preview, choices) : null,
      totals: gathered ? { found: items.length, toBring: gathered.units.size + gathered.config.length + gathered.memories.reduce((t, m) => t + m.files.length, 0) } : null,
      canScanThisComputer: canScanThisMachine, error: err,
    };
    setImportSnapshot(s);
  }, [phase, homes, exports, gathered, preview, choices, err, admin, info, leftOutSources]);
  useEffect(() => () => setImportSnapshot(null), []);

  const step = phase === 'done' ? 2 : phase === 'importing' ? 1 : 0;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6 max-md:px-4">
        {setup && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Setting up Hearth · step 5 of 6</span>
            <span className="ml-auto flex gap-2">
              {phase !== 'done' && phase !== 'importing' && <Button size="sm" variant="ghost" onClick={setup.onSkip}>Skip for now</Button>}
              {phase === 'done' && <Button size="sm" onClick={() => setup.onContinue(receipt ? oneLine(receipt) : plain ?? '')}>Continue setup</Button>}
            </span>
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-tight">Bring everything from Claude</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Your Claude Code conversations, claude.ai chats and memories, and your skills, subagents, slash commands and plugins, to {serverName} in one go. Hearth copies them: nothing is removed from Claude, from this computer or from your export.</p>
        <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1', i < step && 'border-primary/40 text-primary', i === step && 'border-primary bg-primary/10 font-medium text-foreground', i > step && 'text-muted-foreground')}>
              {i < step ? <Check className="size-3" /> : <span className="tabular-nums">{i + 1}</span>}{s.label}
            </li>
          ))}
        </ol>
        {err && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />{err}</p>}
        {!admin && <p className="mt-4 rounded-lg border bg-card px-3 py-2 text-sm">Only an admin device can import. Tick "admin device" for this device on the server's page, then come back.</p>}
        {admin && info && !info.available && <p className="mt-4 rounded-lg border bg-card px-3 py-2 text-sm">This server has no place to keep imported history yet (its import store isn't set up).</p>}

        {admin && info?.available && (phase === 'finding' || phase === 'ready') && (
          <div className="mt-5 space-y-5">
            <section aria-labelledby="h-computer">
              <h3 id="h-computer" className="mb-2 flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4 text-muted-foreground" />On this computer</h3>
              {!canScanThisMachine && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">Claude Code keeps its conversations on your computer. Open the Hearth desktop app there to bring them across, with your skills and plugins. Here you can still add a claude.ai export.</p>}
              {canScanThisMachine && !sources && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Looking for Claude Code…</p>}
              {canScanThisMachine && sources?.length === 0 && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No Claude Code on this computer. If you use it on another computer, run Hearth there too.</p>}
              {!!sources?.length && (
                <ul className="divide-y rounded-xl border bg-card">
                  {sources.map((s) => <HomeRow key={s.path} s={s} units={scan?.units.filter((u) => u.from === s.path || u.also?.includes(s.path)) ?? null} />)}
                </ul>
              )}
              {scanning && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{scanning.total ? `Reading conversations: ${n(scanning.done)} of ${n(scanning.total)}…` : 'Reading…'} Nothing is sent yet.</p>}
            </section>

            <section aria-labelledby="h-claudeai">
              <h3 id="h-claudeai" className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileArchive className="size-4 text-muted-foreground" />From claude.ai (and the Claude app's chats)</h3>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void filesFromDrop(e.dataTransfer).then(addFiles, (x) => setErr(errorText(x))); }}
                className={cn('rounded-xl border border-dashed px-4 py-4 text-sm transition-colors', drag ? 'border-primary bg-primary/5' : 'bg-card')}>
                <p>Drop your claude.ai export here: the zip claude.ai emailed you, several zips, or the folder you unzipped it into. Add the whole thing; Hearth finds the parts.</p>
                <p className="mt-1 text-xs text-muted-foreground">No export yet? On claude.ai: Settings, Privacy, Export data. One per account.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input ref={zipIn} type="file" accept=".zip,.json" multiple className="hidden" onChange={(e) => { void addFiles(filesFromInput(e.target.files)); e.target.value = ''; }} />
                  <input ref={dirIn} type="file" multiple className="hidden" {...{ webkitdirectory: '' }} onChange={(e) => { void addFiles(filesFromInput(e.target.files)); e.target.value = ''; }} />
                  <Button size="sm" variant="outline" onClick={() => dirIn.current?.click()} disabled={reading}><FolderOpen className="size-3.5" />Add a folder</Button>
                  <Button size="sm" variant="outline" onClick={() => zipIn.current?.click()} disabled={reading}><Upload className="size-3.5" />Add zips</Button>
                  {reading && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Opening the export…</span>}
                </div>
              </div>
              {exports.length > 0 && (
                <ul className="mt-2 divide-y rounded-xl border bg-card">
                  {exports.map((x) => <ExportRow key={x.account} x={x} />)}
                </ul>
              )}
              {files.length > 0 && <Button size="sm" variant="ghost" className="mt-1" onClick={() => { setFiles([]); setExports([]); }}>Clear the exports</Button>}
            </section>

            <section aria-labelledby="h-skills" ref={skillsRef} className={cn(part === 'skills' && 'rounded-xl ring-2 ring-primary/40 ring-offset-4 ring-offset-background')}>
              <h3 id="h-skills" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Puzzle className="size-4 text-muted-foreground" />Skills, subagents, slash commands and plugins</h3>
              <SkillsSummary gathered={gathered} config={config} scanning={!!scanning} />
            </section>

            <Summary gathered={gathered} preview={preview} choices={choices} info={info} planning={planning} busy={!gathered || planning || !!scanning || reading}
              lastTime={Object.entries(info?.decisions ?? {}).filter(([, v]) => v.decision === 'leave-out').length}
              onGo={() => void go()} onReview={() => setPhase('review')} />
          </div>
        )}

        {phase === 'review' && preview && gathered && (
          <Review preview={preview} gathered={gathered} sources={homes} exports={exports} choices={choices} setChoices={setChoices} pool={pool} setPool={setPool}
            leftOutItems={leftOutItems} setLeftOutItems={setLeftOutItems} bring={bring} setBring={setBring} since={since} clientTerms={info?.clientTerms ?? []}
            leftOutSources={leftOutSources} setLeftOutSources={setLeftOutSources} leftOutGroups={leftOutGroups} setLeftOutGroups={setLeftOutGroups}
            scopes={scopes} setScopes={setScopes} config={config} busy={planning} onBack={() => setPhase('ready')} onGo={() => void go()} />
        )}

        {phase === 'importing' && <Running p={progress} onStop={() => { stopped.current = true; }} />}

        {phase === 'done' && lost && (
          <div className="mt-5 space-y-3">
            <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <p className="font-medium">Your server restarted during the import, so this run stopped before it could count a receipt.</p>
              <p className="mt-1">Nothing already stored was lost: {count(lost.committed, 'conversation')} arrived and {lost.committed === 1 ? 'is' : 'are'} kept. Run the import again: it skips what is already there, brings the rest, and gives you the receipt.</p>
            </div>
            <Button onClick={() => { setLost(null); setReceipt(null); setPlain(null); setErr(null); setPreview(null); setPhase('finding'); setAgainPending(true); setRerun((x) => x + 1); }}>Run it again</Button>
          </div>
        )}

        {phase === 'done' && !lost && (receipt || plain) && (
          <div className="mt-5 space-y-4">
            {receipt ? <ImportReceipt receipt={receipt} serverName={serverName} /> : <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">{plain}</p>}
            <p className="text-sm text-muted-foreground">Each project's history is in the sidebar, under the project. Search history finds anything you said or were told. Run this again any time: only what is new or changed will move.</p>
            {!setup && <Button onClick={() => { const slug = created[0]; const c = Object.values(choices).find((x) => x.action === 'new' && x.slug === slug) as { name?: string } | undefined; onDone(slug ? { slug, name: c?.name || slug } : undefined); }}>Open Hearth</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function planOf(p: Preview, choices: Record<string, Choice>) {
  const targets = new Set<string>(); let fresh = 0, client = 0;
  for (const x of p.proposals) {
    const c = choices[x.key];
    if (!c || c.action === 'skip' || c.action === 'merge') continue;
    const slug = c.action === 'existing' ? c.slug : c.slug;
    if (targets.has(slug)) continue;
    targets.add(slug);
    if (c.action === 'new') { fresh++; if (c.client) client++; }
    else if (p.projects.find((q) => q.slug === slug)?.client) client++;
  }
  return { projects: targets.size, newProjects: fresh, clientProjects: client, conversationsNew: p.totals.new + p.totals.changed, conversationsAlreadyHere: p.totals.unchanged + p.totals.refile };
}

function HomeRow({ s, units }: { s: LocalSource; units: LocalUnit[] | null }) {
  const w = homeWords(s);
  const last = when(s.lastUsed);
  // At a glance, to decide about old or test-looking homes: when, where most of it is, the commonest projects.
  const st = units && units.length ? homeStats(units) : null;
  const range = st ? dateRange(st.from, st.to) : null;
  return (
    <li className="px-3 py-2.5">
      <p className="text-sm font-medium">{w.title}</p>
      {w.who && <p className="text-xs text-muted-foreground">{w.who}</p>}
      {w.profiles && <p className="mt-0.5 text-xs">{w.profiles}</p>}
      <p className="mt-0.5 text-xs text-muted-foreground">{w.holds}{last ? ` · last used ${last}` : ''}</p>
      {st && (
        <p className="mt-0.5 text-xs" title={st.mostlyIn?.path}>
          {count(st.count, 'conversation')}{range ? `, ${range}` : ''}{st.mostlyIn ? ` · ${st.mostlyIn.n === st.count ? 'all' : `${n(st.mostlyIn.n)}`} in ${st.mostlyIn.name}` : ''}
          {st.top.length ? ` · most in ${st.top.map((t) => `${t.name} (${n(t.n)})`).join(', ')}` : ''}
        </p>
      )}
      {s.home && <p className="font-mono text-xs text-muted-foreground/80" title={s.homePath}>{s.home}</p>}
    </li>
  );
}

function ExportRow({ x }: { x: ChatExport }) {
  const cant = x.notKept.filter((k) => k.reason === 'unsupported');
  return (
    <li className="px-3 py-2.5">
      <p className="text-sm font-medium">{x.label}</p>
      <p className="text-xs text-muted-foreground">{[count(x.units.length, 'chat'), x.memories.length ? count(x.memories.length, 'memory', 'memories') : '', x.skipped ? `${n(x.skipped)} empty` : ''].filter(Boolean).join(' · ')}</p>
      {cant.length > 0 && <p className="mt-0.5 text-xs">Hearth can't keep {count(cant.length, 'other part')} of this export yet (artifacts, Project files): each is named on the receipt.</p>}
      <p className="mt-0.5 text-xs text-muted-foreground">Added from {x.inputs.join(', ')}</p>
    </li>
  );
}

function SkillsSummary({ gathered, config, scanning }: { gathered: Gathered | null; config: ConfigItem[]; scanning: boolean }) {
  if (!canScanThisMachine) return <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">These live with Claude Code on your computer: the Hearth desktop app brings them across.</p>;
  if (scanning || !gathered) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Looking…</p>;
  if (!config.length) return <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No skills, subagents, slash commands or plugins found in Claude Code on this computer.</p>;
  const items = gathered.inventory.items.filter((i) => config.some((c) => c.key === i.id) || gathered.config.some((c) => c.key === i.id));
  const byKind = (k: string) => gathered.config.filter((c) => c.kind === k).length;
  const held = items.filter((i) => i.reason === 'secret' || i.reason === 'client');
  const odd = items.filter((i) => i.reason === 'unreadable');
  const elsewhere = items.filter((i) => i.reason === 'not_loadable');
  const plugins = new Set(config.filter((c) => c.origin.startsWith('plugin:')).map((c) => c.origin));
  const local = gathered.config.filter((c) => c.origin === 'repo').length;
  return (
    <div className="space-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm">
      <p>{gathered.config.length ? `${n(gathered.config.length)} to bring: ${[byKind('skill') && count(byKind('skill'), 'skill'), byKind('agent') && count(byKind('agent'), 'subagent'), byKind('command') && count(byKind('command'), 'slash command'), byKind('output_style') && count(byKind('output_style'), 'output style'), byKind('hook') && count(byKind('hook'), 'set of hooks', 'sets of hooks')].filter(Boolean).join(', ')}${plugins.size ? `, from your own setup and ${count(plugins.size, 'plugin')}` : ''}.` : 'Nothing to bring.'}</p>
      <p className="text-xs text-muted-foreground">They go to every project{local ? `, except ${local === 1 ? 'one' : n(local)} kept inside a project folder, which ${local === 1 ? 'goes' : 'go'} to that folder's project` : ''}. Hooks arrive switched off until you turn them on.</p>
      {held.length > 0 && <p className="flex items-start gap-1.5 text-xs"><Lock className="mt-0.5 size-3 shrink-0" />{count(held.length, 'item stays', 'items stay')} on this computer: {held.map((h) => h.title).slice(0, 5).join(', ')}{held.length > 5 ? '…' : ''}. {held.some((h) => h.reason === 'secret') ? 'They look like they hold a secret' : 'They name a client'}{held.some((h) => h.reason === 'secret') && held.some((h) => h.reason === 'client') ? ', or name a client' : ''}. The receipt names each one.</p>}
      {odd.length > 0 && <p className="text-xs text-muted-foreground">{count(odd.length, 'item')} couldn't be read; the receipt says why.</p>}
      {elsewhere.length > 0 && <p className="text-xs">{count(elsewhere.length, 'skill was', 'skills were')} found where Claude Code doesn't load them ({[...new Set(config.filter((c) => c.nested).map((c) => c.nested!.split('/').slice(0, 2).join('/')))].slice(0, 3).join(', ')}). They aren't brought unless you tick them on the review page.</p>}
    </div>
  );
}

function Summary({ gathered, preview, choices, info, planning, busy, onGo, onReview, lastTime }: { gathered: Gathered | null; preview: Preview | null; choices: Record<string, Choice>; info: Info | null; planning: boolean; busy: boolean; onGo: () => void; onReview: () => void; lastTime: number }) {
  if (!gathered) return null;
  const items = gathered.inventory.items;
  const by = (k: string) => items.filter((i) => i.kind === k).length;
  const cfg = items.filter((i) => ['skill', 'agent', 'command', 'output_style', 'hook'].includes(i.kind)).length;
  const twice = items.filter((i) => i.dupOf).length;
  const other = items.filter((i) => i.kind === 'other').length;
  const plan = preview ? planOf(preview, choices) : null;
  const nothing = !items.length;
  return (
    <section aria-labelledby="h-summary" className="rounded-xl border bg-card p-4">
      <h3 id="h-summary" className="text-sm font-semibold">{nothing ? 'Nothing found yet' : `Found ${count(items.length, 'thing')}`}</h3>
      {!nothing && <p className="mt-1 text-sm">{[by('conversation') && count(by('conversation'), 'Claude Code conversation'), by('chat') && count(by('chat'), 'claude.ai chat'), by('memory') && count(by('memory'), 'memory', 'memories'), cfg && count(cfg, 'skill or the like', 'skills and the like'), other && count(other, 'other part', 'other parts')].filter(Boolean).join(', ')}.
        {twice ? ` ${count(twice, 'is the same thing', 'are the same things')} found in a second place: brought once.` : ''}</p>}
      {plan && (
        <p className="mt-1 text-sm text-muted-foreground">
          Suggested: conversations go into {count(plan.projects, 'project')}, one per repo or folder{plan.newProjects ? ` (${n(plan.newProjects)} new` : ''}{plan.clientProjects ? `${plan.newProjects ? ', ' : ' ('}${n(plan.clientProjects)} tagged as client work` : ''}{plan.newProjects || plan.clientProjects ? ')' : ''}.
          {plan.conversationsAlreadyHere ? ` ${n(plan.conversationsAlreadyHere)} conversations are already on this server; only new and changed ones move.` : ''}
        </p>
      )}
      {nothing && <p className="mt-1 text-sm text-muted-foreground">Add a claude.ai export above, or use Claude Code on this computer first.</p>}
      {lastTime > 0 && <p className="mt-1 text-sm">As in your last import, {count(lastTime, 'thing you left out stays', 'things you left out stay')} out. The review page shows which, and the receipt will list them.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={onGo} disabled={busy || nothing}>{planning ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Bring everything across</Button>
        <Button variant="outline" onClick={onReview} disabled={busy || nothing || !preview}>Review the suggestions</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Nothing is removed from Claude, from this computer or from your export: Hearth copies.{info?.conversations ? ` This server already has ${n(info.conversations)} imported conversations.` : ''} At the end, your server counts what it kept.</p>
    </section>
  );
}

function Running({ p, onStop }: { p: RunProgress | null; onStop: () => void }) {
  const c = p?.conversations;
  const pct = c?.bytesTotal ? Math.round(c.bytesDone / c.bytesTotal * 100) : c ? 100 : 0;
  const line = (label: string, on: boolean, done: boolean, text: string) => (
    <li className={cn('flex items-center gap-2 text-sm', !on && !done && 'text-muted-foreground')}>
      {done ? <Check className="size-3.5 text-success" /> : on ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-3.5" />}<span className="font-medium">{label}</span><span className="text-muted-foreground tabular-nums">{text}</span>
    </li>
  );
  const order = ['conversations', 'extensions', 'memories', 'counting'];
  const at = order.indexOf(p?.phase ?? 'conversations');
  return (
    <section className="mt-5 space-y-3">
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${p?.phase === 'conversations' ? pct : 100}%` }} /></div>
      <ul className="space-y-1.5">
        {line('Conversations and chats', at === 0, at > 0, c ? `${n(c.done)} of ${n(c.total)} · ${mb(c.bytesDone)} of ${mb(c.bytesTotal)}` : '')}
        {line('Skills and the like', at === 1, at > 1, p ? `${n(p.extensions.done)} of ${n(p.extensions.total)}` : '')}
        {line('Memories', at === 2, at > 2, p ? `${n(p.memories.done)} of ${n(p.memories.total)}` : '')}
        {line('Counting what was kept', at === 3, false, '')}
      </ul>
      {c?.current && p?.phase === 'conversations' && <p className="truncate text-xs text-muted-foreground">Now: {c.current}</p>}
      {(c?.failed.length ?? 0) > 0 && <p className="text-xs text-destructive">{n(c!.failed.length)} didn't arrive; the receipt names them, and they are tried again next time.</p>}
      {p?.phase === 'conversations' && <Button variant="outline" size="sm" onClick={onStop}>Stop after this one</Button>}
    </section>
  );
}

// ---------- the optional review: grouped and searchable, never a list that must be visited row by row ----------

type GroupId = 'existing' | 'client' | 'new' | 'merged' | 'chats' | 'other' | 'skipped';
const GROUPS: { id: GroupId; label: string; sub: string }[] = [
  { id: 'existing', label: 'Into projects you already have', sub: 'Their folder is inside one of your projects, or an earlier import filed them there.' },
  { id: 'client', label: 'New client projects', sub: 'In a client folder: kept as client work.' },
  { id: 'new', label: 'New projects', sub: 'One per repo or folder.' },
  { id: 'merged', label: 'Joined to another folder', sub: 'A copy or branch of a repo next to it, or a repo inside another.' },
  { id: 'chats', label: 'claude.ai chats', sub: 'By their claude.ai Project, else together.' },
  { id: 'other', label: 'Home, temporary and one-off folders', sub: 'Gathered so they don’t make a project each.' },
  { id: 'skipped', label: 'Left out', sub: 'Not brought across this time.' },
];
function groupOf(p: Proposal, c: Choice | undefined): GroupId {
  if (!c || c.action === 'skip') return 'skipped';
  if (c.action === 'merge') return 'merged';
  if (p.key.startsWith('chat:')) return 'chats';
  if (c.action === 'existing') return 'existing';
  if (p.key === 'home' || p.key === 'temp' || p.key.startsWith('dated:')) return 'other';
  return c.client ? 'client' : 'new';
}

function Review({ preview, gathered, sources, exports, choices, setChoices, pool, setPool, leftOutSources, setLeftOutSources, leftOutGroups, setLeftOutGroups, scopes, setScopes, config, busy, onBack, onGo,
  leftOutItems, setLeftOutItems, bring, setBring, since, clientTerms }: {
  leftOutItems: Set<string>; setLeftOutItems: (s: Set<string>) => void; bring: Set<string>; setBring: (s: Set<string>) => void; since: Record<string, string>; clientTerms: string[];
  preview: Preview; gathered: Gathered; sources: LocalSource[]; exports: ChatExport[];
  choices: Record<string, Choice>; setChoices: (f: (c: Record<string, Choice>) => Record<string, Choice>) => void; pool: string; setPool: (p: string) => void;
  leftOutSources: Set<string>; setLeftOutSources: (s: Set<string>) => void; leftOutGroups: Set<string>; setLeftOutGroups: (s: Set<string>) => void;
  scopes: Record<string, string>; setScopes: (f: (s: Record<string, string>) => Record<string, string>) => void; config: ConfigItem[]; busy: boolean; onBack: () => void; onGo: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<GroupId>>(new Set());
  const query = q.trim().toLowerCase();
  const grouped = useMemo(() => {
    const m = new Map<GroupId, Proposal[]>();
    for (const p of preview.proposals) {
      if (query && !`${p.name} ${p.path} ${p.client ?? ''}`.toLowerCase().includes(query)) continue;
      const g = groupOf(p, choices[p.key]);
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return m;
  }, [preview, choices, query]);
  const toggle = <T,>(set: Set<T>, v: T) => { const x = new Set(set); if (x.has(v)) x.delete(v); else x.add(v); return x; };
  // Held back (a secret, a client name) and not loadable where they are: worked out here, so a ticked one keeps its row.
  const client = useMemo(() => clientMatcher(clientTerms), [clientTerms]);
  const heldList = useMemo(() => config.filter((c) => c.content != null && !c.problem).map((c) => {
    const h = holdBack(c.name, c.content!, c.files, client);
    return h ? { c, ...h, lines: h.reason === 'secret' ? [c.content!, ...Object.values(c.files ?? {})].flatMap((t) => secretLines(t)).slice(0, 3) : [] } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x), [config, client]);
  const heldKeys = useMemo(() => new Set(heldList.map((h) => h.c.key)), [heldList]);
  const elsewhere = useMemo(() => config.filter((c) => c.nested && c.content != null && !heldKeys.has(c.key)), [config, heldKeys]);
  const cfgGroups = useMemo(() => {
    const m = new Map<string, ConfigItem[]>();
    for (const c of config) if (c.content != null && !c.problem && !c.nested && !heldKeys.has(c.key)) m.set(configGroup(c), [...(m.get(configGroup(c)) ?? []), c]);
    return [...m.entries()];
  }, [config, heldKeys]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const day = (target: string) => (since[target] ? new Date(since[target]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);
  const labelOf = (items: ConfigItem[]) => {
    const c = items[0];
    const home = sources.find((s) => s.path === c.source);
    const where = home ? homeWords(home).title : 'a project folder';
    return c.origin === 'repo' ? `Kept in ${c.repo?.split('/').pop()} (a project folder)` : c.origin.startsWith('plugin:') ? `The plugin ${c.origin.slice(7)} (${where})` : `Your own (${where})`;
  };
  const projects = [...preview.projects, ...preview.proposals.filter((p) => choices[p.key]?.action === 'new').map((p) => ({ slug: (choices[p.key] as { slug: string }).slug, name: (choices[p.key] as { name: string }).name, client: (choices[p.key] as { client: string | null }).client }))];
  return (
    <section className="mt-5 space-y-5">
      <p className="text-sm">Everything below is already set to the suggestions. Change only what you want; the rest stays as suggested.</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold">What to bring</h3>
        <ul className="divide-y rounded-xl border bg-card">
          {[...sources.map((s) => ({ id: s.path, label: homeWords(s).title, sub: homeWords(s).holds })), ...exports.map((x) => ({ id: `claude-ai:${x.account}`, label: x.label, sub: `${count(x.units.length, 'chat')}${x.memories.length ? ` · ${count(x.memories.length, 'memory', 'memories')}` : ''}` }))].map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" className="size-4 accent-primary" checked={!leftOutSources.has(s.id)} onChange={() => setLeftOutSources(toggle(leftOutSources, s.id))} aria-label={`Bring ${s.label}`} />
              <span className="min-w-0 flex-1"><span className="block text-sm">{s.label}</span><span className="block text-xs text-muted-foreground">{s.sub}</span></span>
              {leftOutSources.has(s.id) && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{day(`import:source:${s.id}`) ? `Left out on ${day(`import:source:${s.id}`)}` : 'Left out'}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Where conversations go</h3>
        <p className="mb-2 text-xs text-muted-foreground">{count(preview.proposals.length, 'folder')} in {count(planOf(preview, choices).projects, 'project')}. Open a group, or search, to change one.</p>
        <label className="relative mb-2 block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a folder, project or client" aria-label="Find a folder, project or client" className={cn(field, 'pl-8')} />
        </label>
        <div className="space-y-2">
          {GROUPS.filter((g) => grouped.get(g.id)?.length).map((g) => {
            const list = grouped.get(g.id)!;
            const isOpen = !!query || open.has(g.id);
            return (
              <div key={g.id} className="rounded-xl border bg-card">
                <button type="button" onClick={() => setOpen(toggle(open, g.id))} aria-expanded={isOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                  <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <span className="text-sm font-medium">{g.label}</span><span className="text-xs text-muted-foreground tabular-nums">{n(list.length)}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground max-sm:hidden">{g.sub}</span>
                </button>
                {isOpen && <ul className="divide-y border-t">{list.slice(0, 300).map((p) => <ProposalRow key={p.key} p={p} preview={preview} choices={choices} setChoices={setChoices} leftOutOn={choices[p.key]?.action === 'skip' ? day(`import:place:${p.key}`) : null} />)}</ul>}
              </div>
            );
          })}
          {!grouped.size && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No folder or project matches "{q}".</p>}
        </div>
        {preview.pools.length > 1 && (
          <label className="mt-2 flex items-center gap-2 text-sm">New personal projects run on
            <select value={pool} onChange={(e) => setPool(e.target.value)} className={cn(inputCls, 'w-40')}>{preview.pools.map((x) => <option key={x}>{x}</option>)}</select>
            {preview.clientPool && <span className="text-muted-foreground">· client projects on {preview.clientPool}</span>}
          </label>
        )}
      </div>

      {cfgGroups.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Where skills and the like go</h3>
          <p className="mb-2 text-xs text-muted-foreground">Suggested by where they came from: your own and plugins' to every project, a project folder's to that project.</p>
          <ul className="divide-y rounded-xl border bg-card">
            {cfgGroups.map(([g, items]) => {
              const suggested = items[0].origin === 'repo' ? 'its project' : 'every project';
              const value = leftOutGroups.has(g) ? 'out' : scopes[g] ?? '';
              return (
                <li key={g} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setOpenGroups(toggle(openGroups, g))} aria-expanded={openGroups.has(g)} className="flex min-w-0 flex-1 items-start gap-1.5 text-left">
                    <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', openGroups.has(g) && 'rotate-90')} />
                    <span className="min-w-0"><span className="block text-sm">{labelOf(items)}{day(`import:group:${g}`) && leftOutGroups.has(g) ? <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Left out on {day(`import:group:${g}`)}</span> : null}</span>
                      <span className="block truncate text-xs text-muted-foreground">{n(items.filter((c) => !leftOutItems.has(c.key)).length)} of {n(items.length)} ticked: {items.map((c) => c.name).slice(0, 6).join(', ')}{items.length > 6 ? `, and ${n(items.length - 6)} more` : ''}</span></span>
                  </button>
                  <select aria-label={`Where ${labelOf(items)} goes`} value={value} className={cn(inputCls, 'w-52')}
                    onChange={(e) => { const v = e.target.value; const out = new Set(leftOutGroups); out.delete(g); if (v === 'out') out.add(g); setLeftOutGroups(out); setScopes((s) => { const x = { ...s }; if (v && v !== 'out') x[g] = v; else delete x[g]; return x; }); }}>
                    <option value="">As suggested ({suggested})</option>
                    <option value="global">Every project</option>
                    <optgroup label="One project">{projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}{p.client ? ` (${p.client})` : ''}</option>)}</optgroup>
                    <option value="out">Leave out</option>
                  </select>
                  </div>
                  {openGroups.has(g) && (
                    <ul className="mt-1.5 space-y-1 pl-5">
                      {items.map((c) => (
                        <li key={c.key} className="flex items-start gap-2 text-sm">
                          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={!leftOutItems.has(c.key) && !leftOutGroups.has(g)} disabled={leftOutGroups.has(g)}
                            onChange={() => setLeftOutItems(toggle(leftOutItems, c.key))} aria-label={`Bring ${c.name}`} />
                          <span className="min-w-0 flex-1"><span>{c.name}</span> <span className="text-xs text-muted-foreground">{KIND_NAME[c.kind] ?? c.kind}{c.description ? ` · ${c.description}` : ''}</span>
                            {leftOutItems.has(c.key) && day(`import:ext:${c.key}`) && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Left out on {day(`import:ext:${c.key}`)}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {heldList.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Held back on this computer</h3>
          <p className="mb-2 text-xs text-muted-foreground">They look like they hold a secret, or name a client, so they stay here. If it's a false alarm, tick it to bring it anyway: the receipt will say you chose to. The lines shown never leave this computer.</p>
          <ul className="divide-y rounded-xl border bg-card">
            {heldList.map((h) => (
              <li key={h.c.key} className="flex items-start gap-3 px-3 py-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={bring.has(h.c.key)} onChange={() => setBring(toggle(bring, h.c.key))} aria-label={`Bring ${h.c.name} anyway`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{h.c.name} <span className="text-xs text-muted-foreground">{KIND_NAME[h.c.kind] ?? h.c.kind}{h.c.origin.startsWith('plugin:') ? ` · plugin ${h.c.origin.slice(7)}` : ''}</span></span>
                  <span className="block text-xs">{h.detail}</span>
                  {h.lines.map((l, k) => <code key={k} className="mt-0.5 block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]" title={l}>{l}</code>)}
                </span>
                {bring.has(h.c.key) && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-text">Bring anyway</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {elsewhere.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Found where Claude Code doesn't load them</h3>
          <p className="mb-2 text-xs text-muted-foreground">Skills one folder down (like skills/development/) and loose files in skills/. Claude Code doesn't use them from there, so they stay behind unless you tick them.</p>
          <ul className="divide-y rounded-xl border bg-card">
            {elsewhere.map((c) => (
              <li key={c.key} className="flex items-start gap-3 px-3 py-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={bring.has(c.key)} onChange={() => setBring(toggle(bring, c.key))} aria-label={`Bring ${c.name}`} />
                <span className="min-w-0 flex-1"><span className="block text-sm">{c.name}{c.description ? <span className="text-xs text-muted-foreground"> · {c.description}</span> : null}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{c.nested}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">Everything is stored on your server encrypted at rest, client work included. Nothing is removed from Claude or this computer.</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onGo} disabled={busy || !gathered.inventory.items.length}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Bring everything across</Button>
      </div>
    </section>
  );
}

const KIND_NAME: Record<string, string> = { skill: 'skill', agent: 'subagent', command: 'slash command', output_style: 'output style', hook: 'hooks' };

function ProposalRow({ p, preview, choices, setChoices, leftOutOn }: { p: Proposal; preview: Preview; choices: Record<string, Choice>; setChoices: (f: (c: Record<string, Choice>) => Record<string, Choice>) => void; leftOutOn?: string | null }) {
  const set = (c: Choice) => setChoices((cur) => ({ ...cur, [p.key]: c }));
  const c = choices[p.key] ?? { action: 'skip' };
  const value = c.action === 'new' ? 'new' : c.action === 'existing' ? `existing:${c.slug}` : c.action === 'merge' ? `merge:${c.into}` : 'skip';
  const targets = preview.proposals.filter((o) => o.key !== p.key && choices[o.key]?.action === 'new');
  return (
    <li className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-3 py-2.5', c.action === 'skip' && 'opacity-60')}>
      <div className="min-w-0">
        {c.action === 'new' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Project name" value={c.name} onChange={(e) => set({ ...c, name: e.target.value })} className={cn(inputCls, 'max-w-60 font-medium')} />
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className={cn('size-3', !c.client && 'opacity-30')} />
              <input aria-label="Client" value={c.client ?? ''} placeholder="client (blank: personal)" onChange={(e) => set({ ...c, client: e.target.value || null })} className={cn(inputCls, 'w-44 text-xs')} /></span>
          </div>
        ) : <p className="truncate text-sm font-medium">{c.action === 'existing' ? preview.projects.find((x) => x.slug === c.slug)?.name ?? p.name : p.name}</p>}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.path || (p.key === 'temp' ? 'Folders in the temp folder' : p.key === 'home' ? 'Your home folder' : p.key.startsWith('chat:') ? 'claude.ai' : p.key.startsWith('dated:') ? 'Dated one-off folders' : 'No folder')}{' · '}
          {count(p.conversations, 'conversation')}{p.new ? ` · ${n(p.new)} new` : ''}{p.changed ? ` · ${n(p.changed)} changed` : ''}{p.unchanged ? ` · ${n(p.unchanged)} already here` : ''}{p.bytes >= 5 << 20 ? ` · ${mb(p.bytes)}` : ''}{leftOutOn ? ` · left out on ${leftOutOn}` : ''}</p>
      </div>
      <select aria-label={`Where ${p.name} goes`} value={value} className={cn(inputCls, 'w-52 self-start')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'new') set({ action: 'new', name: p.name, slug: p.slug, client: p.client });
          else if (v === 'skip') set({ action: 'skip' });
          else if (v.startsWith('existing:')) set({ action: 'existing', slug: v.slice(9) });
          else set({ action: 'merge', into: v.slice(6) });
        }}>
        <option value="new">New project</option>
        {preview.projects.length > 0 && <optgroup label="Add to an existing project">{preview.projects.map((x) => <option key={x.slug} value={`existing:${x.slug}`}>{x.name}{x.client ? ` (${x.client})` : ''}</option>)}</optgroup>}
        <optgroup label="Join with">{targets.map((o) => <option key={o.key} value={`merge:${o.key}`}>{(choices[o.key] as { name?: string }).name || o.name}</option>)}
          {c.action === 'merge' && !targets.some((o) => o.key === c.into) && <option value={value}>{preview.proposals.find((o) => o.key === c.into)?.name ?? c.into}</option>}</optgroup>
        <option value="skip">Leave out</option>
      </select>
    </li>
  );
}
