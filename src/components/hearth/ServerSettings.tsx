// Settings sections that read the server's own records (each shown only when the server has the extension):
// the audit log (`audit`, admin devices). Nothing here is chat content.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';
import { field, fieldArea } from '@/components/ui/field';
import { ConfirmLine } from '@/components/hearth/ConfirmLine';

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
  if (error) return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>;
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
      <h3 className="mt-8 mb-2 text-sm font-semibold">Each day</h3>
      <div className="flex h-28 items-end gap-px rounded-xl border bg-card p-2" role="img" aria-label={`Cost per day for the last ${r.days} days, highest ${usd(max)}`}>
        {days.map((d) => {
          const v = perDay.get(d) ?? 0;
          return <div key={d} title={`${d}: ${usd(v)}`} className="flex-1 rounded-t-sm bg-primary/70 hover:bg-primary" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} />;
        })}
      </div>
      <h3 className="mt-8 mb-2 text-sm font-semibold">This month, by project</h3>
      {!r.projects.length ? <p className="text-sm text-muted-foreground">Nothing yet this month.</p> : (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {[...r.projects].sort((a, b) => b.monthCost - a.monthCost).map((p) => {
            const pct = p.budget ? Math.min(100, (p.monthCost / p.budget) * 100) : null;
            return (
              <li key={p.project} className="px-3 py-2">
                <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><span className="tabular-nums">{usd(p.monthCost)}</span>{p.budget && <span className="text-xs text-muted-foreground tabular-nums">of {usd(p.budget)}</span>}</div>
                {pct !== null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={pct >= 100 ? 'h-full bg-destructive' : pct >= 80 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${pct}%` }} /></div>}
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
  const [askHook, setAskHook] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // A hook asks once more before it is saved (the server wants confirm: true for hooks).
  const save = async (confirm = false) => {
    if (!edit) return;
    if (edit.kind === 'hook' && !confirm) { setAskHook(true); return; }
    setAskHook(false);
    setBusy(true);
    try { await request('_hearth/extensions/save', { ...edit, confirm }); setEdit(null); load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <SectionHead title="Extensions" sub="Your own skills, slash commands, subagents, hooks and output styles. They reach every project's agents (or one project's). A repo's own .claude folder is never used."
        action={<Button size="sm" onClick={() => setEdit({ kind: 'command', scope: 'global', enabled: true, name: '', content: '' })}>Add</Button>} />
      {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      <ClaudeImport request={request} onDone={load} onError={setError} />
      <PluginImport request={request} onDone={load} onError={setError} />
      {edit && (
        <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} aria-label="Kind" className={cn(field, 'w-auto px-2')}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase() })} placeholder="name-with-dashes" aria-label="Name" className={cn(field, 'w-auto min-w-40 flex-1 font-mono')} />
            <input value={edit.scope ?? 'global'} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} placeholder="global or a project" aria-label="Scope" className={cn(field, 'w-40')} />
          </div>
          <input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="What it is for (shown to the agent)" aria-label="Description" className={field} />
          <p className="text-xs text-muted-foreground">{KIND_HINT[edit.kind ?? 'command']}</p>
          <textarea value={edit.content ?? ''} onChange={(e) => setEdit({ ...edit, content: e.target.value })} rows={8} spellCheck={false} aria-label="Content"
            className={cn(fieldArea, 'font-mono text-xs')} />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={edit.enabled !== false} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} className="size-4 accent-primary" />On</label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEdit(null); setAskHook(false); }}>Cancel</Button>
              <Button size="sm" disabled={busy || askHook || !edit.name || !edit.content} onClick={() => void save()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Save</Button>
            </div>
          </div>
          {askHook && <ConfirmLine question="Hooks run shell commands as the agent on every matching tool call, in every project they apply to. Save it?"
            yes="Save hook" no="Not yet" destructive={false} busy={busy} onYes={() => void save(true)} onNo={() => setAskHook(false)} />}
        </div>
      )}
      {!items && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {items && !items.length && !edit && <p className="text-sm text-muted-foreground">None yet. Add a slash command your agents should know, a skill, or a reviewer subagent.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[x.kind] ?? x.kind}</span>
              <span className="min-w-0 flex-1"><span className="font-mono font-medium">{x.kind === 'command' ? '/' : ''}{x.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{x.scope === 'global' ? 'Every project' : x.scope}{x.description ? ` · ${x.description}` : ''}{x.enabled ? '' : ' · off'}</span></span>
              <Button size="sm" variant="ghost" onClick={() => setEdit(x)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(x.id)}>Delete</Button>
              {deleting === x.id && <ConfirmLine className="basis-full" question={`Delete ${x.name}?`} yes="Delete" onNo={() => setDeleting(null)}
                onYes={() => { setDeleting(null); request('_hearth/extensions/delete', { id: x.id }).then(load, (e) => setError(errorText(e))); }} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface McpServer { name: string; title: string; url: string | null; client: string | null; enabled: boolean; has_token: boolean; oauth?: boolean; expiresAt?: string | null;
  transport?: 'http' | 'stdio'; command?: string | null; args?: string[] | null; env_names?: string[] }
type McpForm = { kind: 'http' | 'stdio'; name: string; title: string; url: string; token: string; client: string; command: string; args: string; env: string };
const EMPTY_FORM: McpForm = { kind: 'http', name: '', title: '', url: '', token: '', client: '', command: '', args: '', env: '' };
/** "NAME=value" lines -> an env object (blank lines skipped). */
function envLines(text: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf('=');
    if (i < 1) return `"${line.slice(0, 40)}" isn't NAME=value`;
    out[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

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
  const [form, setForm] = useState<McpForm | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
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
      <SectionHead title="Connectors" sub="MCP servers your agents can use: a web address, or a command the agent starts on its runner (like Claude Code's stdio servers). Give a project the ones it needs in its settings. Tokens and environment values are stored encrypted and never shown."
        action={<Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>Add</Button>} />
      {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {form && (
        <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="name" aria-label="Name" className={cn(field, 'w-40 font-mono')} />
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What it is (e.g. Linear)" aria-label="Title" className={cn(field, 'w-auto min-w-40 flex-1')} />
          </div>
          <div role="radiogroup" aria-label="Kind" className="flex gap-1 text-xs">
            {(['http', 'stdio'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => setForm({ ...form, kind: k })}
                className={cn('rounded-md border px-2 py-1', form.kind === k ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground')}>
                {k === 'http' ? 'Web address' : 'Command (stdio)'}</button>))}
          </div>
          {form.kind === 'http' ? (<>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" aria-label="URL" className={cn(field, 'font-mono')} />
            <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} type="password" autoComplete="off" placeholder="Token (leave empty for OAuth sign-in or no token)" aria-label="Token" className={field} />
          </>) : (<>
            <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="Command, e.g. npx" aria-label="Command" className={cn(field, 'font-mono')} />
            <textarea value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} rows={3} placeholder={'Arguments, one per line, e.g.\n-y\n@azure-devops/mcp\nmy-org'} aria-label="Arguments" className={cn(field, 'font-mono')} />
            <textarea value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} rows={2} autoComplete="off" spellCheck={false} placeholder={'Environment, NAME=value per line (stored encrypted), e.g.\nAZURE_DEVOPS_PAT=…'} aria-label="Environment" className={cn(field, 'font-mono')} />
            <p className="text-xs text-muted-foreground">It runs on the project's runner as the project's own user, started by the agent, as Claude Code does.</p>
          </>)}
          <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Client (only for a client's own login)" aria-label="Client" className={field} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button size="sm" disabled={!form.name || (form.kind === 'http' ? !form.url : !form.command.trim())} onClick={async () => {
              const env = form.kind === 'stdio' ? envLines(form.env) : {};
              if (typeof env === 'string') { setError(`Environment: ${env}`); return; }
              const target = form.kind === 'http'
                ? { url: form.url, ...(form.token ? { token: form.token } : {}) }
                : { command: form.command.trim(), args: form.args.split('\n').map((a) => a.trim()).filter(Boolean), env };
              try { await request('_hearth/mcp/save', { name: form.name, title: form.title, ...target, ...(form.client ? { client: form.client } : {}) }); setForm(null); load(); }
              catch (e) { setError(errorText(e)); }
            }}>Save</Button>
          </div>
        </div>
      )}
      {!items && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {items && !items.length && !form && <p className="text-sm text-muted-foreground">No connectors yet.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {items.map((s) => (
            <li key={s.name} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><span className="font-mono font-medium">{s.name}</span>{s.title && <span className="text-muted-foreground"> · {s.title}</span>}
                  <span className="block truncate text-xs text-muted-foreground">{s.transport === 'stdio'
                    ? <>command: <span className="font-mono">{[s.command, ...(s.args ?? [])].join(' ')}</span>{s.client ? ` · client ${s.client}` : ''}{s.env_names?.length ? ` · env ${s.env_names.join(', ')}` : ''}</>
                    : <>{s.url}{s.client ? ` · client ${s.client}` : ''} · {s.oauth ? 'signed in (OAuth)' : s.has_token ? 'token set' : 'no token'}</>}</span></span>
                {s.transport !== 'stdio' && <Button size="sm" variant="ghost" onClick={() => void test(s.name)}>Test</Button>}
                {s.transport !== 'stdio' && <Button size="sm" variant="ghost" onClick={() => void signIn(s.name)}>{s.oauth ? 'Sign in again' : 'Sign in'}</Button>}
                <Button size="sm" variant="ghost" onClick={() => setRemoving(s.name)}>Remove</Button>
              </div>
              {removing === s.name && <ConfirmLine className="mt-2" question={`Remove ${s.name}? Projects that use it lose it.`} yes="Remove" onNo={() => setRemoving(null)}
                onYes={() => { setRemoving(null); request('_hearth/mcp/delete', { name: s.name }).then(load, (e) => setError(errorText(e))); }} />}
              {tests[s.name] && <p className="mt-1 text-xs text-muted-foreground">{tests[s.name]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Schedules moved to its own file (Schedules.tsx); re-exported so Settings keeps one import.
export { SchedulesPage } from '@/components/hearth/Schedules';

interface CcItem { key: string; source: string; kind: string; name: string; description: string | null; bytes: number; importable: boolean; held?: string[]; leftOut?: string[] }
const HELD: Record<string, string> = { 'names-a-client': 'names a client' };

/**
 * Bring Claude Code's own skills, slash commands, subagents, output styles and hooks over from the laptop (the work
 * runner reads ~/.claude). Anything that looks like it holds a secret or names a client stays on the laptop.
 */
function ClaudeImport({ request, onDone, onError }: { request: Request; onDone: () => void; onError: (m: string) => void }) {
  const [items, setItems] = useState<CcItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState('global');
  const [busy, setBusy] = useState(false);
  const [askHooks, setAskHooks] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const look = async () => {
    setBusy(true); setItems(null); setDone(null);
    try {
      const r = await request<{ items: CcItem[] }>('_hearth/extensions/import', { source: 'claude-code' });
      setItems(r.items);
      setPicked(new Set(r.items.filter((i) => i.importable && i.kind !== 'hook').map((i) => i.key)));
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  };
  const hooksPicked = !!items?.some((i) => i.kind === 'hook' && picked.has(i.key));
  const install = async (confirmed = false) => {
    if (hooksPicked && !confirmed) { setAskHooks(true); return; }
    setAskHooks(false); setBusy(true);
    try {
      const picks = [...picked].map((key) => ({ key, scope: scope.trim() || 'global' }));
      const r = await request<{ saved: string[]; skipped: string[] }>('_hearth/extensions/import', { source: 'claude-code', install: true, picks, confirmHooks: hooksPicked });
      setDone(`Imported ${r.saved.length}${r.skipped.length ? `, left out ${r.skipped.length}: ${r.skipped.join(', ')}` : ''}.`);
      setItems(null); onDone();
    } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  };
  const toggle = (k: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="mb-4 rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Import from Claude Code</div>
          <p className="text-xs text-muted-foreground">Your skills, slash commands, subagents, output styles and hooks, read from Claude Code on the work runner.</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void look()}>{busy && !items && <Loader2 className="size-3.5 animate-spin" />}{items ? 'Look again' : 'Look'}</Button>
      </div>
      {items && !items.length && <p className="mt-2 text-xs text-muted-foreground">Claude Code has nothing Hearth can import on that runner.</p>}
      {items && items.length > 0 && (
        <div className="mt-2 space-y-2">
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 px-2 py-1.5">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" aria-label={`Import ${i.name}`} disabled={!i.importable}
                  checked={picked.has(i.key)} onChange={() => toggle(i.key)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate"><span className="text-xs text-muted-foreground">{KIND_LABEL[i.kind] ?? i.kind}</span> {i.name}</div>
                  {i.importable
                    ? i.description && <div className="truncate text-xs text-muted-foreground">{i.description}</div>
                    : <div className="text-xs text-muted-foreground">Stays on the laptop: {(i.held ?? []).map((h) => HELD[h] ?? `looks like it holds a ${h}`).join(', ') || 'not readable'}</div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input value={scope} onChange={(e) => setScope(e.target.value)} aria-label="For" placeholder="global or a project" className={cn(field, 'h-8 w-40 px-2 text-xs')} />
            <Button size="sm" disabled={!picked.size || busy || askHooks} onClick={() => void install()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Import {picked.size || ''}</Button>
          </div>
          {askHooks && <ConfirmLine question="Hooks run shell commands as the agent on every matching tool call. Import the ticked hooks?"
            yes="Import with hooks" no="Not yet" destructive={false} busy={busy} onYes={() => void install(true)} onNo={() => setAskHooks(false)} />}
        </div>
      )}
      {done && <p className="mt-2 text-xs text-muted-foreground">{done}</p>}
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
  const [askHooks, setAskHooks] = useState(false);
  const install = async (confirmed = false) => {
    if (hooks && !confirmed) { setAskHooks(true); return; }
    setAskHooks(false);
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
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label="Plugin repository" className={cn(field, 'w-auto min-w-56 flex-1 font-mono text-xs')} />
        <Button size="sm" variant="outline" disabled={!url.trim() || busy} onClick={() => void look()}>{busy && !preview && <Loader2 className="size-3.5 animate-spin" />}Look</Button>
      </div>
      {preview && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{preview.plugin}: {preview.found.length ? preview.found.map((f) => `${KIND_LABEL[f.kind] ?? f.kind} ${f.name}`).join(', ') : 'nothing Hearth can use'}</p>
          {preview.found.some((f) => f.kind === 'hook') && (
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hooks} onChange={(e) => setHooks(e.target.checked)} className="size-4 accent-primary" />Also install its hooks (they run commands)</label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input value={scope} onChange={(e) => setScope(e.target.value)} aria-label="For" placeholder="global or a project" className={cn(field, 'h-8 w-40 px-2 text-xs')} />
            <Button size="sm" disabled={!preview.found.length || busy || askHooks} onClick={() => void install()}>{busy && <Loader2 className="size-3.5 animate-spin" />}Install</Button>
          </div>
          {askHooks && <ConfirmLine question="This plugin's hooks run shell commands as the agent on every matching tool call. Install them?"
            yes="Install with hooks" no="Not yet" destructive={false} busy={busy} onYes={() => void install(true)} onNo={() => setAskHooks(false)} />}
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
        className={cn(field, 'mb-3')} />
      {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {!entries && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}
      {entries && !entries.length && <p className="text-sm text-muted-foreground">Nothing recorded{filter ? ' that matches' : ''}.</p>}
      {entries && entries.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2">
              <span className="truncate font-mono text-xs">{e.action}</span>
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
