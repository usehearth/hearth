// Import wizard: bring Claude history into Hearth and carry on as if nothing changed.
// Steps: connect (done once the app is on a server) -> find (Claude Code folders on this machine, claude.ai export
// zips) -> review (one project per folder or repo: rename, tag a client, merge, skip) -> import (progress) -> done.
// Re-runnable: a second run only moves new and changed conversations. Engine: src/lib/importer.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, FileArchive, FolderSearch, HardDrive, Loader2, Lock, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';
import { mergeExports, readClaudeExport, type ChatExport } from '@/lib/claudeai';
import { canScanThisMachine, defaultChoices, localReader, localSources, memoryReader, mergeUnits, previewOf, scanLocal, upload,
  type Begun, type Choice, type LocalSource, type LocalUnit, type Preview, type Progress, type Reader } from '@/lib/importer';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type Step = 'find' | 'review' | 'import' | 'done';
const STEPS: { id: Step | 'connect'; label: string }[] = [{ id: 'connect', label: 'Connect' }, { id: 'find', label: 'Find' }, { id: 'review', label: 'Review' }, { id: 'import', label: 'Import' }, { id: 'done', label: 'Done' }];
const mb = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.max(0.1, n / (1 << 20)).toFixed(1)} MB`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '');
const inputCls = 'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/40';

interface Info { available: boolean; conversations: number; sealed: number; legacy: number; projects: number; lastRun: { finished_at: string | null; status: string } | null }

export function ImportWizard({ request, serverName, admin, onDone }: { request: Request; serverName: string; admin: boolean; onDone: (project?: { slug: string; name: string }) => void }) {
  const [step, setStep] = useState<Step>('find');
  const [info, setInfo] = useState<Info | null>(null);
  const [sources, setSources] = useState<LocalSource[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exports, setExports] = useState<ChatExport[]>([]);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [pool, setPool] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ begun: Begun; report: any } | null>(null);
  const units = useRef<Map<string, { unit: LocalUnit; reader: Reader }>>(new Map());
  const stopped = useRef(false);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    request<Info>('_hearth/import/info').then(setInfo, (e) => setErr(errorText(e)));
    localSources().then((s) => { setSources(s); setPicked(new Set(s.map((x) => x.path))); }, (e) => { setSources([]); setErr(errorText(e)); });
  }, [request]);

  const addExport = async (files: FileList | null) => {
    setErr(null);
    for (const f of Array.from(files ?? [])) {
      // The same account's parts (conversations-000.zip, memories-000.zip) add up; a newer copy of a part replaces the old.
      try { const x = await readClaudeExport(f); setExports((cur) => { const same = cur.find((c) => c.account === x.account); return [...cur.filter((c) => c.account !== x.account), same ? mergeExports(same, x) : x]; }); }
      catch (e) { setErr(`${f.name}: ${errorText(e)}`); }
    }
    if (fileIn.current) fileIn.current.value = '';
  };

  const look = async () => {
    setErr(null); setScan({ done: 0, total: 0 });
    try {
      const lists: { units: LocalUnit[]; reader: Reader }[] = [];
      let home = '';
      if (picked.size) { const r = await scanLocal([...picked], (done, total) => setScan({ done, total })); home = r.home; lists.push({ units: r.units, reader: localReader }); }
      for (const x of exports) lists.push({ units: x.units, reader: memoryReader(x.bytes) });
      units.current = mergeUnits(lists);
      if (!units.current.size) {
        // Only memories picked (a newer memories-000.zip): save them, nothing to review.
        if (exports.some((x) => x.memories.length)) { const n = await saveMemories(); setErr(null); setNote(`Saved ${n} claude.ai memories to the knowledge hub.`); return; }
        setErr('No conversations found in what you picked.'); return;
      }
      const p = await previewOf(request, [...units.current.values()].map((v) => v.unit), home);
      setPreview(p); setChoices(defaultChoices(p)); setPool(p.defaultPool); setStep('review');
    } catch (e) { setErr(errorText(e)); } finally { setScan(null); }
  };

  const go = async () => {
    if (!preview) return;
    setErr(null);
    try {
      const begun = await request<Begun>('_hearth/import/begin', { token: preview.token, choices, pool });
      setStep('import'); stopped.current = false;
      const fin = await upload(request, begun, units.current, setProgress, () => stopped.current);
      const memories = await saveMemories();
      setResult({ begun, report: { ...fin.report, memories } }); setStep('done');
    } catch (e) { setErr(errorText(e)); }
  };

  /** claude.ai memories go to the knowledge hub as shared notes (updated in place on a re-run). */
  async function saveMemories(): Promise<number> {
    let n = 0;
    for (const x of exports) if (x.memories.length) n += (await request<{ memories: number }>('_hearth/import/memories', { account: x.account, files: x.memories })).memories;
    return n;
  }

  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6 max-md:px-4">
        <h2 className="text-lg font-semibold tracking-tight">Import your Claude history</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Bring your Claude Code conversations and claude.ai chats to {serverName}, filed by project, and carry on where you left off. You can run this again any time to pick up new conversations.</p>
        <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1', i < current && 'border-primary/40 text-primary', i === current && 'border-primary bg-primary/10 font-medium text-foreground', i > current && 'text-muted-foreground')}>
              {i < current ? <Check className="size-3" /> : <span className="tabular-nums">{i + 1}</span>}{s.label}
            </li>
          ))}
        </ol>
        {err && <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{err}</p>}
        {note && <p className="mt-4 flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{note}</p>}
        {!admin && <p className="mt-4 rounded-lg border bg-card px-3 py-2 text-sm">Only an admin device can import. Tick "admin device" for this device on the server's page, then come back.</p>}
        {admin && info && !info.available && <p className="mt-4 rounded-lg border bg-card px-3 py-2 text-sm">This server has no place to keep imported history yet (its import store isn't set up).</p>}

        {admin && info?.available && step === 'find' && (
          <section className="mt-5 space-y-4">
            <p className="flex items-center gap-2 text-sm"><Check className="size-4 text-primary" />Connected to <span className="font-medium">{serverName}</span>{info.conversations > 0 && <span className="text-muted-foreground">· it already has {info.conversations} imported conversations; only new and changed ones will move</span>}</p>
            <div className="rounded-xl border bg-card">
              <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium"><HardDrive className="size-4 text-muted-foreground" />Claude Code on this computer</div>
              {!canScanThisMachine && <p className="px-4 py-3 text-sm text-muted-foreground">Claude Code folders can be read by the Hearth desktop app. Here you can still add claude.ai exports.</p>}
              {canScanThisMachine && !sources && <Loader2 className="m-4 size-4 animate-spin text-muted-foreground" />}
              {canScanThisMachine && sources?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No Claude Code conversations found on this computer.</p>}
              {sources?.map((s) => (
                <label key={s.path} className="flex cursor-pointer items-center gap-3 border-b px-4 py-2 last:border-0 hover:bg-accent/40">
                  <input type="checkbox" checked={picked.has(s.path)} onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.path); else n.delete(s.path); return n; })} />
                  <span className="min-w-0 flex-1"><span className="block text-sm">{s.label}</span><span className="block truncate text-xs text-muted-foreground">{s.path}</span></span>
                  <span className="text-xs tabular-nums text-muted-foreground">{s.conversations} conversation{s.conversations === 1 ? "" : "s"}</span>
                </label>
              ))}
            </div>
            <div className="rounded-xl border bg-card">
              <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium"><FileArchive className="size-4 text-muted-foreground" />claude.ai chats (also the desktop app's Chat tab)</div>
              <div className="space-y-2 px-4 py-3 text-sm">
                <p className="text-muted-foreground">On claude.ai: Settings, Privacy, Export data. Add the zip it emails you. One per account.</p>
                {exports.map((x) => <p key={x.account} className="flex items-center gap-2"><Check className="size-3.5 text-primary" />{x.label}: {x.units.length} chats{x.skipped ? ` (${x.skipped} empty skipped)` : ''}{x.memories.length ? `, ${x.memories.length} memories` : ''}</p>)}
                <input ref={fileIn} type="file" accept=".zip,.json" multiple className="hidden" onChange={(e) => void addExport(e.target.files)} />
                <Button variant="outline" size="sm" onClick={() => fileIn.current?.click()}><Upload className="size-3.5" />Add an export</Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => void look()} disabled={!!scan || (!picked.size && !exports.length)}>{scan ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}Look through them</Button>
              {scan && <span className="text-sm text-muted-foreground">{scan.total ? `Reading ${scan.done} of ${scan.total}…` : 'Reading…'}</span>}
            </div>
          </section>
        )}

        {step === 'review' && preview && (
          <Review preview={preview} choices={choices} setChoices={setChoices} pool={pool} setPool={setPool} onBack={() => setStep('find')} onGo={() => void go()} />
        )}

        {step === 'import' && (
          <section className="mt-5 space-y-3">
            {!progress && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {progress && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress.bytesTotal ? Math.round(progress.bytesDone / progress.bytesTotal * 100) : 100}%` }} /></div>
                <p className="text-sm tabular-nums">{progress.done} of {progress.total} conversations · {mb(progress.bytesDone)} of {mb(progress.bytesTotal)}</p>
                {progress.current && <p className="truncate text-xs text-muted-foreground">Now: {progress.current}</p>}
                {progress.failed.length > 0 && <p className="text-xs text-destructive">{progress.failed.length} could not be imported (they'll be tried again next time).</p>}
                <Button variant="outline" size="sm" onClick={() => { stopped.current = true; }}>Stop after this one</Button>
              </>
            )}
          </section>
        )}

        {step === 'done' && result && (
          <section className="mt-5 space-y-3">
            <p className="flex items-center gap-2 text-sm"><Check className="size-4 text-primary" />
              Imported {result.report?.uploaded ?? 0} conversations{result.begun.created.length ? `, made ${result.begun.created.length} projects` : ''}{result.begun.refiled ? `, moved ${result.begun.refiled} to their project` : ''}{result.begun.unchanged ? `; ${result.begun.unchanged} were already here` : ''}.{result.report?.memories ? ` Saved ${result.report.memories} claude.ai memories to the knowledge hub.` : ''}</p>
            {(progress?.failed.length ?? 0) > 0 && (
              <details className="rounded-lg border bg-card px-3 py-2 text-sm"><summary className="cursor-pointer">{progress!.failed.length} not imported</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{progress!.failed.slice(0, 50).map((f, i) => <li key={i}>{f.title}: {f.error}</li>)}</ul></details>
            )}
            <p className="text-sm text-muted-foreground">Each project's history is in the sidebar, under the project. Search history finds anything you said or were told.</p>
            <Button onClick={() => { const slug = result.begun.created[0]; const c = Object.values(choices).find((x) => x.action === 'new' && x.slug === slug) as { name?: string } | undefined; onDone(slug ? { slug, name: c?.name || slug } : undefined); }}>Open Hearth</Button>
          </section>
        )}
      </div>
    </div>
  );
}

function Review({ preview, choices, setChoices, pool, setPool, onBack, onGo }: { preview: Preview; choices: Record<string, Choice>; setChoices: (f: (c: Record<string, Choice>) => Record<string, Choice>) => void; pool: string; setPool: (p: string) => void; onBack: () => void; onGo: () => void }) {
  const set = (key: string, c: Choice) => setChoices((cur) => ({ ...cur, [key]: c }));
  const byKey = useMemo(() => new Map(preview.proposals.map((p) => [p.key, p])), [preview]);
  const targets = preview.proposals.filter((p) => choices[p.key]?.action === 'new');
  const t = preview.totals;
  const making = targets.length, clients = targets.filter((p) => (choices[p.key] as any)?.client).length;
  return (
    <section className="mt-5 space-y-3">
      <p className="text-sm">Found <span className="font-medium">{t.conversations}</span> conversations ({mb(t.bytes)}): {t.new} new, {t.changed} changed, {t.unchanged} already here{t.refile ? `, ${t.refile} to move to a better project` : ''}.
        Each folder or repo becomes its own project. Rename them, tag client work, merge folders that belong together, or skip ones you don't want.</p>
      <div className="divide-y rounded-xl border bg-card">
        {preview.proposals.map((p) => {
          const c = choices[p.key] ?? { action: 'skip' };
          const value = c.action === 'new' ? 'new' : c.action === 'existing' ? `existing:${c.slug}` : c.action === 'merge' ? `merge:${c.into}` : 'skip';
          return (
            <div key={p.key} className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-4 py-2.5', c.action === 'skip' && 'opacity-60')}>
              <div className="min-w-0">
                {c.action === 'new' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label="Project name" value={c.name} onChange={(e) => set(p.key, { ...c, name: e.target.value })} className={cn(inputCls, 'max-w-60 font-medium')} />
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className={cn('size-3', !c.client && 'opacity-30')} />
                      <input aria-label="Client" value={c.client ?? ''} placeholder="client (blank: personal)" onChange={(e) => set(p.key, { ...c, client: e.target.value || null })} className={cn(inputCls, 'w-44 text-xs')} /></span>
                  </div>
                ) : <p className="truncate text-sm font-medium">{p.name}</p>}
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.path || (p.key === 'temp' ? 'Folders in the temp folder' : p.key === 'home' ? 'Your home folder' : p.key.startsWith('chat:') ? 'claude.ai' : p.key.startsWith('dated:') ? 'Dated one-off folders' : 'No folder')}{' · '}
                  {p.conversations} conversation{p.conversations === 1 ? '' : 's'}{p.new ? ` · ${p.new} new` : ''}{p.changed ? ` · ${p.changed} changed` : ''}{p.last ? ` · last ${day(p.last)}` : ''}</p>
              </div>
              <select aria-label={`Where ${p.name} goes`} value={value} className={cn(inputCls, 'w-56 self-start')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'new') set(p.key, { action: 'new', name: p.name, slug: p.slug, client: p.client });
                  else if (v === 'skip') set(p.key, { action: 'skip' });
                  else if (v.startsWith('existing:')) set(p.key, { action: 'existing', slug: v.slice(9) });
                  else set(p.key, { action: 'merge', into: v.slice(6) });
                }}>
                <option value="new">New project</option>
                {preview.projects.length > 0 && <optgroup label="Add to an existing project">{preview.projects.map((x) => <option key={x.slug} value={`existing:${x.slug}`}>{x.name}{x.client ? ` (${x.client})` : ''}</option>)}</optgroup>}
                <optgroup label="Merge with">{preview.proposals.filter((o) => o.key !== p.key && choices[o.key]?.action === 'new').map((o) => <option key={o.key} value={`merge:${o.key}`}>{(choices[o.key] as any).name || o.name}</option>)}
                  {c.action === 'merge' && !targets.some((o) => o.key === c.into) && <option value={value}>{byKey.get(c.into)?.name ?? c.into}</option>}</optgroup>
                <option value="skip">Don't import</option>
              </select>
            </div>
          );
        })}
      </div>
      {preview.pools.length > 1 && (
        <label className="flex items-center gap-2 text-sm">New personal projects run on
          <select value={pool} onChange={(e) => setPool(e.target.value)} className={cn(inputCls, 'w-40')}>{preview.pools.map((x) => <option key={x}>{x}</option>)}</select>
          {clients > 0 && preview.clientPool && <span className="text-muted-foreground">· client projects on {preview.clientPool}</span>}
        </label>
      )}
      <p className="text-xs text-muted-foreground">Everything is stored on your server encrypted at rest, client work included.</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onGo}>Import{making ? ` and make ${making} project${making > 1 ? 's' : ''}` : ''}</Button>
      </div>
    </section>
  );
}
