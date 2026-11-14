// Settings sections that read the server's own records (each shown only when the server has the extension):
// the audit log (`audit`, admin devices). Nothing here is chat content.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';

export type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}</div>
      {action}
    </div>
  );
}

interface UsageReport {
  days: number; currency: string;
  byDay: { day: string; project: string; cost: number; sessions: number }[];
  projects: { project: string; name: string; monthCost: number; budget: number | null }[];
}

const usd = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);

/** What the agents cost: this month per project (against its budget), and each day of the last 30. */
export function UsagePage({ request }: { request: Request }) {
  const [r, setR] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { request<UsageReport>('_hearth/usage', { days: 30 }).then((x) => { setR(x); setError(null); }, (e) => setError(errorText(e))); }, [request]);
  useEffect(load, [load]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!r) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>;
  const days: string[] = [];
  for (let i = r.days - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const perDay = new Map<string, number>();
  for (const d of r.byDay) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.cost);
  const max = Math.max(0.01, ...perDay.values());
  const total = [...perDay.values()].reduce((a, b) => a + b, 0);
  const month = r.projects.reduce((a, p) => a + p.monthCost, 0);
  return (
    <div>
      <SectionHead title="Usage" sub="What the agents cost, from the engines' own reports. Projects can have a monthly budget (project settings)."
        action={<Button size="sm" variant="outline" onClick={load}><RefreshCw className="size-3.5" />Refresh</Button>} />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">This month</div><div className="text-xl font-semibold tabular-nums">{usd(month)}</div></div>
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">Last {r.days} days</div><div className="text-xl font-semibold tabular-nums">{usd(total)}</div></div>
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold">Each day</h3>
      <div className="flex h-28 items-end gap-px rounded-lg border bg-card p-2" role="img" aria-label={`Cost per day for the last ${r.days} days, highest ${usd(max)}`}>
        {days.map((d) => {
          const v = perDay.get(d) ?? 0;
          return <div key={d} title={`${d}: ${usd(v)}`} className="flex-1 rounded-t-sm bg-primary/70 hover:bg-primary" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} />;
        })}
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold">This month, by project</h3>
      {!r.projects.length ? <p className="text-sm text-muted-foreground">Nothing yet this month.</p> : (
        <ul className="divide-y rounded-xl border text-sm">
          {[...r.projects].sort((a, b) => b.monthCost - a.monthCost).map((p) => {
            const pct = p.budget ? Math.min(100, (p.monthCost / p.budget) * 100) : null;
            return (
              <li key={p.project} className="px-3 py-2">
                <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><span className="tabular-nums">{usd(p.monthCost)}</span>{p.budget && <span className="text-xs text-muted-foreground tabular-nums">of {usd(p.budget)}</span>}</div>
                {pct !== null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={pct >= 100 ? 'h-full bg-destructive' : pct >= 80 ? 'h-full bg-amber-500' : 'h-full bg-primary'} style={{ width: `${pct}%` }} /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Extension { id: string; kind: string; name: string; scope: string; description: string | null; content: string; enabled: boolean; updated_at: string }
const KIND_LABEL: Record<string, string> = { skill: 'Skill', command: 'Slash command', agent: 'Subagent', hook: 'Hook', output_style: 'Output style' };
const KIND_HINT: Record<string, string> = {
  skill: 'Instructions the agent loads when the task fits (like a SKILL.md).',
  command: 'A /command: its text is the prompt. $ARGUMENTS takes what follows the command.',
  agent: 'A subagent the main agent can hand work to: its system prompt.',
  hook: 'JSON for Claude Code hooks, e.g. {"PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "npm run lint"}]}]}',
  output_style: 'How the agent writes its answers.',
};

/**
 * The owner's own skills, slash commands, subagents, hooks and output styles (admin devices). They reach every
 * session (global) or one project's; a repo's own .claude/ folder is never loaded.
 */
export function ExtensionsPage({ request }: { request: Request }) {
  const [items, setItems] = useState<Extension[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Extension> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { request<{ extensions: Extension[] }>('_hearth/extensions', {}).then((r) => { setItems(r.extensions); setError(null); }, (e) => setError(errorText(e))); }, [request]);
  useEffect(load, [load]);
  const save = async () => {
    if (!edit) return;
    let confirm = false;
    if (edit.kind === 'hook') {
      confirm = window.confirm('Hooks run shell commands as the agent on every matching tool call, in every project they apply to. Save it?');
      if (!confirm) return;
    }
    setBusy(true);
    try { await request('_hearth/extensions/save', { ...edit, confirm }); setEdit(null); load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <SectionHead title="Extensions" sub="Your own skills, slash commands, subagents, hooks and output styles. They reach every project's agents (or one project's). A repo's own .claude folder is never used."
        action={<Button size="sm" onClick={() => setEdit({ kind: 'command', scope: 'global', enabled: true, name: '', content: '' })}>Add</Button>} />
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      <PluginImport request={request} onDone={load} onError={setError} />
      {edit && (
        <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} aria-label="Kind" className="h-9 rounded-md border bg-background px-2">
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase() })} placeholder="name-with-dashes" aria-label="Name" className="h-9 min-w-40 flex-1 rounded-md border bg-background px-3 font-mono" />
            <input value={edit.scope ?? 'global'} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} placeholder="global or a project" aria-label="Scope" className="h-9 w-40 rounded-md border bg-background px-3" />
          </div>
          <input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="What it is for (shown to the agent)" aria-label="Description" className="h-9 w-full rounded-md border bg-background px-3" />
          <p className="text-xs text-muted-foreground">{KIND_HINT[edit.kind ?? 'command']}</p>
          <textarea value={edit.content ?? ''} onChange={(e) => setEdit({ ...edit, content: e.target.value })} rows={8} spellCheck={false} aria-label="Content"
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={edit.enabled !== false} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} className="size-4 accent-primary" />On</label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
              <Button size="sm" disabled={busy || !edit.name || !edit.content} onClick={() => void save()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Save</Button>
            </div>
          </div>
        </div>
      )}
      {!items && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {items && !items.length && !edit && <p className="text-sm text-muted-foreground">None yet. Add a slash command your agents should know, a skill, or a reviewer subagent.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {items.map((x) => (
            <li key={x.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[x.kind] ?? x.kind}</span>
              <span className="min-w-0 flex-1"><span className="font-mono font-medium">{x.kind === 'command' ? '/' : ''}{x.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{x.scope === 'global' ? 'Every project' : x.scope}{x.description ? ` · ${x.description}` : ''}{x.enabled ? '' : ' · off'}</span></span>
              <Button size="sm" variant="ghost" onClick={() => setEdit(x)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete ${x.name}?`)) request('_hearth/extensions/delete', { id: x.id }).then(load, (e) => setError(errorText(e))); }}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface McpServer { name: string; title: string; url: string; client: string | null; enabled: boolean; has_token: boolean; oauth?: boolean; expiresAt?: string | null }

/** Open a sign-in page: the system browser in the desktop app, a new tab on the web. */
async function openExternal(url: string) {
  if ('__TAURI_INTERNALS__' in window) {
    try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); return; } catch { /* fall back */ }
  }
  window.open(url, '_blank', 'noopener');
}

/** MCP connectors: the servers agents can be given (per project, in project settings). Admin devices. */
export function ConnectorsPage({ request }: { request: Request }) {
  const [items, setItems] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; title: string; url: string; token: string; client: string } | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const load = useCallback(() => { request<{ servers: McpServer[] }>('_hearth/mcp', {}).then((r) => { setItems(r.servers); setError(null); }, (e) => setError(errorText(e))); }, [request]);
  useEffect(load, [load]);
  const test = async (name: string) => {
    setTests((t) => ({ ...t, [name]: 'Testing…' }));
    try {
      const r = await request<{ ok: boolean; tools?: string[]; error?: string; ms: number }>('_hearth/mcp/test', { name });
      setTests((t) => ({ ...t, [name]: r.ok ? `${r.tools!.length} tool${r.tools!.length === 1 ? '' : 's'} (${r.ms} ms)` : r.error ?? 'failed' }));
    } catch (e) { setTests((t) => ({ ...t, [name]: errorText(e) })); }
  };
  const signIn = async (name: string) => {
    try {
      const r = await request<{ connected?: boolean; authorizationUrl?: string }>('_hearth/mcp/oauth/start', { name });
      if (r.authorizationUrl) { await openExternal(r.authorizationUrl); setTests((t) => ({ ...t, [name]: 'Finish signing in in the browser, then Test.' })); }
      else { setTests((t) => ({ ...t, [name]: 'Signed in.' })); load(); }
    } catch (e) { setError(errorText(e)); }
  };
  return (
    <div>
      <SectionHead title="Connectors" sub="MCP servers your agents can use. Give a project the ones it needs in its settings. Tokens are stored encrypted and never shown."
        action={<Button size="sm" onClick={() => setForm({ name: '', title: '', url: '', token: '', client: '' })}>Add</Button>} />
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {form && (
        <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="name" aria-label="Name" className="h-9 w-40 rounded-md border bg-background px-3 font-mono" />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What it is (e.g. Linear)" aria-label="Title" className="h-9 min-w-40 flex-1 rounded-md border bg-background px-3" />
          </div>
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" aria-label="URL" className="h-9 w-full rounded-md border bg-background px-3 font-mono" />
          <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} type="password" autoComplete="off" placeholder="Token (leave empty for OAuth sign-in or no token)" aria-label="Token" className="h-9 w-full rounded-md border bg-background px-3" />
          <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Client (only for a client's own login)" aria-label="Client" className="h-9 w-full rounded-md border bg-background px-3" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button size="sm" disabled={!form.name || !form.url} onClick={async () => {
              try { await request('_hearth/mcp/save', { name: form.name, title: form.title, url: form.url, ...(form.token ? { token: form.token } : {}), ...(form.client ? { client: form.client } : {}) }); setForm(null); load(); }
              catch (e) { setError(errorText(e)); }
            }}>Save</Button>
          </div>
        </div>
      )}
      {!items && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {items && !items.length && !form && <p className="text-sm text-muted-foreground">No connectors yet.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {items.map((s) => (
            <li key={s.name} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><span className="font-mono font-medium">{s.name}</span>{s.title && <span className="text-muted-foreground"> · {s.title}</span>}
                  <span className="block truncate text-xs text-muted-foreground">{s.url}{s.client ? ` · client ${s.client}` : ''} · {s.oauth ? 'signed in (OAuth)' : s.has_token ? 'token set' : 'no token'}</span></span>
                <Button size="sm" variant="ghost" onClick={() => void test(s.name)}>Test</Button>
                <Button size="sm" variant="ghost" onClick={() => void signIn(s.name)}>{s.oauth ? 'Sign in again' : 'Sign in'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Remove ${s.name}? Projects that use it lose it.`)) request('_hearth/mcp/delete', { name: s.name }).then(load, (e) => setError(errorText(e))); }}>Remove</Button>
              </div>
              {tests[s.name] && <p className="mt-1 text-xs text-muted-foreground">{tests[s.name]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Schedule { id: number; project: string; cron: string; tz: string; kind: string; title: string; prompt: string; enabled: boolean; last_run_at: string | null; handler: string | null }
interface Trigger { id: number; name: string; project: string; source: string; title: string; enabled: boolean; queued?: number; hookUrl?: string }
interface Run { schedule_id?: number; trigger_id?: number; title?: string; name?: string; started_at: string; status?: string; session_id?: string | null }

/** Schedules (cron) and triggers (poll, webhook, event): what runs on its own. Admin devices. */
export function SchedulesPage({ request }: { request: Request }) {
  const [data, setData] = useState<{ schedules: Schedule[]; next?: { id: number; next: string | null }[]; triggers: Trigger[]; runs: { schedules: Run[]; triggers: Run[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ project: string; title: string; cron: string; prompt: string } | null>(null);
  const load = useCallback(() => { request<any>('_hearth/schedules', {}).then((r) => { setData(r); setError(null); }, (e) => setError(errorText(e))); }, [request]);
  useEffect(load, [load]);
  const call = (path: string, body: unknown = {}) => request('_hearth/schedules/call', { path, body }).then(load, (e) => setError(errorText(e)));
  const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  return (
    <div>
      <SectionHead title="Schedules" sub="Work that runs on its own: timed jobs and triggers (a webhook, a polled tool, a server event). Each run is an ordinary session with its project's rules."
        action={<Button size="sm" onClick={() => setForm({ project: '', title: '', cron: '0 9 * * 1-5', prompt: '' })}>Add</Button>} />
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {form && (
        <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} placeholder="project" aria-label="Project" className="h-9 w-36 rounded-md border bg-background px-3 font-mono" />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" aria-label="Title" className="h-9 min-w-40 flex-1 rounded-md border bg-background px-3" />
            <input value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 9 * * 1-5" aria-label="When (cron)" className="h-9 w-36 rounded-md border bg-background px-3 font-mono" />
          </div>
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} rows={4} placeholder="What the agent should do each time" aria-label="Prompt" className="w-full rounded-md border bg-background px-3 py-2" />
          <p className="text-xs text-muted-foreground">When: minute hour day month weekday, in the server's time zone (0 9 * * 1-5 = weekdays at 09:00).</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button size="sm" disabled={!form.project || !form.title || !form.prompt} onClick={() => void call('/api/schedules', { ...form, kind: 'job', enabled: true }).then(() => setForm(null))}>Save</Button>
          </div>
        </div>
      )}
      {!data && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {data && (
        <>
          <ul className="divide-y rounded-xl border text-sm">
            {!data.schedules.length && <li className="px-3 py-2 text-muted-foreground">No schedules.</li>}
            {data.schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium">{s.title}</span><span className="block truncate text-xs text-muted-foreground">
                  {s.project} · <span className="font-mono">{s.cron}</span> {s.tz} · last run {when(s.last_run_at)}{(() => { const n = data.next?.find((x) => x.id === s.id)?.next; return n && s.enabled ? ` · next ${when(n)}` : ''; })()}{s.handler ? ' · built in' : ''}</span></span>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={s.enabled} onChange={(e) => void call(`/api/schedules/${s.id}`, { enabled: e.target.checked })} className="size-4 accent-primary" />On</label>
                <Button size="sm" variant="ghost" onClick={() => void call(`/api/schedules/${s.id}`, { run: true })}>Run now</Button>
                {!s.handler && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete "${s.title}"?`)) void call(`/api/schedules/${s.id}/delete`); }}>Delete</Button>}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 mb-2 text-sm font-semibold">Triggers</h3>
          <ul className="divide-y rounded-xl border text-sm">
            {!data.triggers.length && <li className="px-3 py-2 text-muted-foreground">No triggers. A GitHub repo can start work from “@hearth” mentions: a webhook trigger, with the repo's webhook at /hook/github/&lt;name&gt; (its key from the page).</li>}
            {data.triggers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium">{t.title || t.name}</span><span className="block truncate text-xs text-muted-foreground">{t.project} · {t.source}{t.queued ? ` · ${t.queued} waiting` : ''}</span></span>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={t.enabled} onChange={(e) => void call(`/api/triggers/${t.id}`, { enabled: e.target.checked })} className="size-4 accent-primary" />On</label>
              </li>
            ))}
          </ul>
          <h3 className="mt-6 mb-2 text-sm font-semibold">Recent runs</h3>
          <ul className="divide-y rounded-xl border text-xs">
            {[...data.runs.schedules, ...data.runs.triggers].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 30).map((r, i) => (
              <li key={i} className="flex gap-2 px-3 py-1.5"><span className="min-w-0 flex-1 truncate">{r.title || r.name}</span><span className="text-muted-foreground">{when(r.started_at)}</span>{r.status && <span className="text-muted-foreground">{r.status}</span>}</li>
            ))}
            {!data.runs.schedules.length && !data.runs.triggers.length && <li className="px-3 py-2 text-muted-foreground">No runs yet.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Install a Claude Code plugin from GitHub: preview what it holds, then install (hooks need their own tick). */
function PluginImport({ request, onDone, onError }: { request: Request; onDone: () => void; onError: (m: string) => void }) {
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState('global');
  const [preview, setPreview] = useState<{ plugin: string; found: { kind: string; name: string; description: string | null }[] } | null>(null);
  const [hooks, setHooks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const look = async () => {
    setBusy(true); setPreview(null); setDone(null);
    try { setPreview(await request('_hearth/extensions/import', { url: url.trim() })); } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  };
  const install = async () => {
    if (hooks && !window.confirm('This plugin\'s hooks run shell commands as the agent on every matching tool call. Install them?')) return;
    setBusy(true);
    try {
      const r = await request<{ saved: string[]; skipped: string[] }>('_hearth/extensions/import', { url: url.trim(), install: true, scope, confirmHooks: hooks });
      setDone(`Installed ${r.saved.length}${r.skipped.length ? `, left out ${r.skipped.length}` : ''}.`); setPreview(null); onDone();
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mb-4 rounded-xl border bg-card p-3 text-sm">
      <div className="font-medium">Install a plugin from GitHub</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label="Plugin repository" className="h-9 min-w-56 flex-1 rounded-md border bg-background px-3 font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={!url.trim() || busy} onClick={() => void look()}>{busy && !preview && <Loader2 className="size-3.5 animate-spin" />}Look</Button>
      </div>
      {preview && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{preview.plugin}: {preview.found.length ? preview.found.map((f) => `${KIND_LABEL[f.kind] ?? f.kind} ${f.name}`).join(', ') : 'nothing Hearth can use'}</p>
          {preview.found.some((f) => f.kind === 'hook') && (
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hooks} onChange={(e) => setHooks(e.target.checked)} className="size-4 accent-primary" />Also install its hooks (they run commands)</label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input value={scope} onChange={(e) => setScope(e.target.value)} aria-label="For" placeholder="global or a project" className="h-8 w-40 rounded-md border bg-background px-2 text-xs" />
            <Button size="sm" disabled={!preview.found.length || busy} onClick={() => void install()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Install</Button>
          </div>
        </div>
      )}
      {done && <p className="mt-2 text-xs text-muted-foreground">{done}</p>}
    </div>
  );
}

interface AuditEntry { id: string; at: string; actor: string; action: string; target: string | null; detail: Record<string, unknown> | null }

const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The audit log: every change on the server and who made it, newest first. */
export function AuditLog({ request }: { request: Request }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (before?: string | null) => {
    setBusy(true);
    try {
      const f = filter.trim();
      const r = await request<{ entries: AuditEntry[]; next: string | null }>('_hearth/audit', { limit: 100, ...(before ? { before } : {}), ...(f ? (/^[a-z_]+\./.test(f) ? { action: f } : { actor: f }) : {}) });
      setEntries((cur) => (before && cur ? [...cur, ...r.entries] : r.entries));
      setNext(r.next);
      setError(null);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }, [request, filter]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  return (
    <div>
      <SectionHead title="Audit log" sub="Every change on the server, with who made it. Newest first."
        action={<Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className="size-3.5" />Refresh</Button>} />
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: an action (chat.) or who (device:…)" aria-label="Filter the audit log"
        className="mb-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {!entries && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {entries && !entries.length && <p className="text-sm text-muted-foreground">Nothing recorded{filter ? ' that matches' : ''}.</p>}
      {entries && entries.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2">
              <span className="truncate font-mono text-[12.5px]">{e.action}</span>
              <time className="text-xs whitespace-nowrap text-muted-foreground" dateTime={e.at}>{when(e.at)}</time>
              <span className="col-span-2 truncate text-xs text-muted-foreground">
                {e.actor}{e.target ? ` · ${e.target}` : ''}{e.detail && Object.keys(e.detail).length ? ` · ${Object.entries(e.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {next && <div className="mt-3"><Button size="sm" variant="outline" onClick={() => void load(next)} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />}Older</Button></div>}
    </div>
  );
}
