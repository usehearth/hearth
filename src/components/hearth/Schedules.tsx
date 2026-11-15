// Settings > Schedules (admin devices, `_hearth/schedules`): what runs on its own, grouped the way you think about it
// (assistant jobs, your other jobs, reminders, triggers), with schedules in words and next and last run at a glance.
// Follows docs/ux-and-brand.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronRight, Loader2, Play, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SectionHead, type Request } from '@/components/hearth/ServerSettings';
import { errorText } from '@/lib/hearth';
import {
  describeCron, describeTrigger, displayTitle, GROUPS, groupOf, isOneOff, sameText, shortWhen, statusOf,
  type Group, type Run, type Schedule, type Status, type Trigger,
} from '@/lib/schedules';
import { cn } from '@/lib/utils';

interface Data { schedules: Schedule[]; next?: { id: number; next: string | null }[]; triggers: Trigger[]; runs: { schedules: Run[]; triggers: Run[] } }

const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
const fullWhen = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : undefined);
const inputCls = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function SchedulesPage({ request }: { request: Request }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { request<Data>('_hearth/schedules', {}).then((r) => { setData(r); setError(null); }, (e) => setError(errorText(e))); }, [request]);
  useEffect(load, [load]);
  const call = (path: string, body: unknown = {}) => request('_hearth/schedules/call', { path, body }).then(load, (e) => { setError(errorText(e)); throw e; });

  const view = useMemo(() => {
    if (!data) return null;
    const next = new Map((data.next ?? []).map((x) => [x.id, x.next]));
    const lastRun = new Map<number, Run>();
    for (const r of [...data.runs.schedules].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) if (r.schedule_id != null && !lastRun.has(r.schedule_id)) lastRun.set(r.schedule_id, r);
    const rows = data.schedules.map((s) => ({ s, next: s.enabled ? next.get(s.id) ?? null : null, run: lastRun.get(s.id), status: statusOf(s, lastRun.get(s.id)) }));
    // Running and on first, soonest next run first; off after; done last.
    const rank = (st: Status) => (st === 'done' ? 3 : st === 'off' ? 2 : 0);
    rows.sort((a, b) => rank(a.status) - rank(b.status) || (a.next ? Date.parse(a.next) : Infinity) - (b.next ? Date.parse(b.next) : Infinity) || a.s.id - b.s.id);
    const by = (g: Group) => rows.filter((r) => groupOf(r.s) === g);
    const titles = new Map(data.schedules.map((s) => [s.id, displayTitle(s)]));
    const runs = [...data.runs.schedules, ...data.runs.triggers].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 8)
      .map((r) => ({ ...r, label: (r.schedule_id != null ? titles.get(r.schedule_id) : undefined) ?? r.title ?? r.name ?? 'Run' }));
    return { by, runs };
  }, [data]);

  return (
    <div>
      <SectionHead title="Schedules" sub="Work that runs on its own. Each run is an ordinary session, with its project's rules."
        action={<div className="flex gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="Refresh" title="Refresh" onClick={load}><RefreshCw className="size-3.5" /></Button>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}><Plus className="size-3.5" />Add a job</Button>
        </div>} />
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {adding && <AddJob onCancel={() => setAdding(false)} onSave={(f) => call('/api/schedules', { ...f, kind: 'job', enabled: true }).then(() => setAdding(false))} />}
      {!view && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</p>}
      {view && (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const rows = view.by(g.id);
            const live = g.id === 'reminders' ? rows.filter((r) => r.status !== 'done') : rows;
            const done = g.id === 'reminders' ? rows.filter((r) => r.status === 'done') : [];
            return (
              <section key={g.id} aria-labelledby={`sch-${g.id}`}>
                <GroupHead id={`sch-${g.id}`} title={g.title} sub={g.sub} count={live.length} />
                {live.length ? (
                  <ul className="divide-y rounded-xl border bg-card">
                    {live.map((r) => <ScheduleRow key={r.s.id} {...r} reminder={g.id === 'reminders'} call={call} />)}
                  </ul>
                ) : <Empty>{g.id === 'jobs' ? 'No jobs of your own yet. Add a job to run a prompt on a timetable.' : g.id === 'reminders' ? 'No reminders coming up.' : 'None on this server.'}</Empty>}
                {done.length > 0 && (
                  <details className="group mt-2">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />{done.length} done
                    </summary>
                    <ul className="mt-2 divide-y rounded-xl border bg-card">
                      {done.map((r) => <ScheduleRow key={r.s.id} {...r} reminder call={call} />)}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}

          <section aria-labelledby="sch-triggers">
            <GroupHead id="sch-triggers" title="Triggers" sub="Start work when something happens, not at a time." count={data!.triggers.length} />
            {data!.triggers.length ? (
              <ul className="divide-y rounded-xl border bg-card">{data!.triggers.map((t) => <TriggerRow key={t.id} t={t} call={call} />)}</ul>
            ) : (
              <Empty icon={<Zap className="size-4" />}>
                No triggers yet. A trigger is a poll (a tool checked on a timer), a server event (a task fails or needs you) or a webhook (another service calls in).
              </Empty>
            )}
          </section>

          <section aria-labelledby="sch-runs">
            <GroupHead id="sch-runs" title="Recent runs" />
            {view.runs.length ? (
              <ul className="divide-y rounded-xl border bg-card">
                {view.runs.map((r, i) => {
                  const st: Status = !r.ended_at && !r.status ? 'running' : r.status && /fail|error|cancel/i.test(r.status) ? 'failed' : 'on';
                  return (
                    <li key={`${r.session_id ?? i}`} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      <Dot status={st} />
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={fullWhen(r.started_at)}>
                        {st === 'running' ? 'running now' : st === 'failed' ? `failed ${shortWhen(r.started_at)}` : shortWhen(r.started_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No runs yet.</Empty>}
          </section>
        </div>
      )}
    </div>
  );
}

function GroupHead({ id, title, sub, count }: { id: string; title: string; sub?: string; count?: number }) {
  return (
    <div className="mb-2">
      <h3 id={id} className="flex items-baseline gap-2 text-sm font-semibold">{title}{count ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span> : null}</h3>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Empty({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}<p>{children}</p>
    </div>
  );
}

const STATUS_LABEL: Record<Status, string> = { on: 'On', off: 'Off', done: 'Done', running: 'Running', failed: 'Last run failed' };

function Dot({ status }: { status: Status }) {
  if (status === 'done') return <Check aria-label="Done" className="size-3.5 shrink-0 text-muted-foreground" />;
  return (
    <span role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} className={cn('size-2 shrink-0 rounded-full',
      status === 'on' && 'bg-success', status === 'running' && 'animate-pulse bg-primary', status === 'failed' && 'bg-destructive',
      status === 'off' && 'border border-muted-foreground/60')} />
  );
}

function ScheduleRow({ s, next, run, status, reminder, call }: { s: Schedule; next: string | null; run?: Run; status: Status; reminder?: boolean; call: (path: string, body?: unknown) => Promise<unknown> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const words = describeCron(s.cron);
  const tz = s.tz && s.tz !== localTz && !isOneOff(s.cron) ? ` (${s.tz})` : '';
  const last = shortWhen(s.last_run_at ?? run?.started_at);
  const when: string[] = [];
  if (status === 'running') when.push('Running now');
  else if (status === 'done') when.push(`Done ${last ?? ''}`.trim());
  else if (status === 'off') when.push('Off');
  else if (next) when.push(`Next ${shortWhen(next)}`);
  if (status === 'failed') { /* shown in red below */ } else if (last && status !== 'done') when.push(`last ran ${last}`);
  else if (!last && status !== 'done' && status !== 'off') when.push('not run yet');
  const act = (p: Promise<unknown>) => { setBusy(true); p.finally(() => setBusy(false)).catch(() => {}); };
  return (
    <li className={cn('flex items-start gap-3 px-3 py-2.5', (status === 'off' || status === 'done') && 'text-muted-foreground')}>
      <span className="mt-1.5 grid size-3.5 shrink-0 place-items-center"><Dot status={status} /></span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm font-medium', status !== 'off' && status !== 'done' && 'text-foreground')}>{displayTitle(s)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {words ? <span>{words}{tz}</span> : <span className="font-mono">{s.cron}{tz}</span>}
          <span aria-hidden> · </span><span className="whitespace-nowrap">{s.project}</span>
        </div>
        {reminder && s.prompt?.trim() && !sameText(s.prompt, displayTitle(s)) && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.prompt}</p>}
        <div className="mt-0.5 text-xs text-muted-foreground" title={fullWhen(next) ? `Next: ${fullWhen(next)}` : undefined}>
          {when.join(' · ')}{status === 'failed' && <>{when.length ? ' · ' : ''}<span className="text-destructive">last run failed</span></>}
        </div>
        {confirm && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground">Delete this {reminder ? 'reminder' : 'job'}?</span>
            <Button size="xs" variant="destructive" disabled={busy} onClick={() => act(call(`/api/schedules/${s.id}/delete`))}>Delete</Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {status !== 'done' && (
          <Button size="icon-sm" variant="ghost" aria-label={`Run ${displayTitle(s)} now`} title="Run now" disabled={busy || status === 'running'}
            onClick={() => act(call(`/api/schedules/${s.id}`, { run: true }))}><Play className="size-3.5" /></Button>
        )}
        {(!s.handler || s.handler === 'reminder') && (
          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${displayTitle(s)}`} title="Delete" disabled={busy} onClick={() => setConfirm(true)}
            className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></Button>
        )}
        {status !== 'done' && (
          <Switch className="ms-1.5" checked={s.enabled} disabled={busy} aria-label={`${displayTitle(s)}: ${s.enabled ? 'on' : 'off'}`}
            onCheckedChange={(v) => act(call(`/api/schedules/${s.id}`, { enabled: v }))} />
        )}
      </div>
    </li>
  );
}

function TriggerRow({ t, call }: { t: Trigger; call: (path: string, body?: unknown) => Promise<unknown> }) {
  const st: Status = !t.enabled ? 'off' : t.last_error ? 'failed' : 'on';
  return (
    <li className={cn('flex items-start gap-3 px-3 py-2.5', !t.enabled && 'text-muted-foreground')}>
      <span className="mt-1.5 grid size-3.5 shrink-0 place-items-center"><Dot status={st} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t.title?.trim() || t.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{describeTrigger(t)}<span aria-hidden> · </span>{t.project}{t.queued ? ` · ${t.queued} waiting` : ''}</div>
        {t.last_error && <div className="mt-0.5 truncate text-xs text-destructive" title={t.last_error}>Last check failed: {t.last_error}</div>}
      </div>
      <Switch className="mt-0.5 shrink-0" checked={t.enabled} aria-label={`${t.title || t.name}: ${t.enabled ? 'on' : 'off'}`} onCheckedChange={(v) => void call(`/api/triggers/${t.id}`, { enabled: v }).catch(() => {})} />
    </li>
  );
}

function AddJob({ onCancel, onSave }: { onCancel: () => void; onSave: (f: { project: string; title: string; cron: string; prompt: string }) => Promise<unknown> }) {
  const [f, setF] = useState({ project: '', title: '', cron: '0 9 * * 1-5', prompt: '' });
  const [busy, setBusy] = useState(false);
  const words = describeCron(f.cron);
  const ok = f.project.trim() && f.title.trim() && f.prompt.trim() && f.cron.trim();
  return (
    <form className="mb-6 space-y-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (!ok) return; setBusy(true); onSave(f).finally(() => setBusy(false)).catch(() => {}); }}>
      <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-muted-foreground" />A new job</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1"><span className="text-xs font-medium">Name</span>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Weekly spend check" className={inputCls} /></label>
        <label className="block space-y-1"><span className="text-xs font-medium">Project</span>
          <input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} placeholder="home" className={cn(inputCls, 'font-mono')} /></label>
      </div>
      <label className="block space-y-1"><span className="text-xs font-medium">When</span>
        <input value={f.cron} onChange={(e) => setF({ ...f, cron: e.target.value })} className={cn(inputCls, 'font-mono')} aria-describedby="sch-when-help" />
        <span id="sch-when-help" className="block text-xs text-muted-foreground">
          {words ? <>{words}, server time.</> : <>Cron (minute hour day month weekday), or a date like 2027-01-31T09:00 for once.</>}
        </span></label>
      <label className="block space-y-1"><span className="text-xs font-medium">What to do each time</span>
        <textarea value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} rows={4} placeholder="Check this week's AI spend and tell me if anything stands out."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" /></label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!ok || busy}>{busy && <Loader2 className="size-3.5 animate-spin" />}Add job</Button>
      </div>
    </form>
  );
}
