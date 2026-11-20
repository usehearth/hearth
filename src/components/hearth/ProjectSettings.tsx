// A project's settings: how its agents work, in short groups that each save on their own (General, Models,
// Permissions, Tools and folders, Budget, GitHub). Each Save sends only its own group's fields to
// `_hearth/project/update` (every field there is optional), the same fields the single Save used to send.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';
import { field, fieldArea } from '@/components/ui/field';
import { ClientPicker } from '@/components/hearth/ClientPicker';

export interface ProjectView {
  slug: string; name: string; kind: string; client: boolean; agent: string;
  /** The client's name, and the server's client mode: in "simple" the client can be changed here (servers with client modes). */
  clientName?: string | null; clientMode?: 'simple' | 'strict';
  roles: { role: string; label: string; model: string | null; default: string }[];
  modelChoices: string[];
  providers: string[] | null;
  availableProviders: { name: string; kind: string; priority: number }[];
  planFirst: boolean;
  tools: string[];
  /** MCP servers that can be picked (admin devices change them; servers with `mcp`). */
  toolChoices?: string[];
  /** The repo's own .mcp.json (personal projects). */
  repoMcp?: { enabled: boolean; found: { name: string; type: string; url: string | null; command: string | null; hash: string; usable: boolean }[]; approved: string[] } | null;
  instructions: string | null;
  /** Permission rules (servers with the `permissions` extension). */
  permissions?: { mode: string; allow: string[]; deny: string[]; defaults: string[]; alwaysDenied: string[]; allowAuto?: boolean };
  /** Monthly budget (servers with `usage`), and what this month cost so far. */
  budget?: { monthlyUsd: number; warnAt: number } | null;
  monthCost?: number;
  /** The git remote (servers with `git`): its URL and whether a token is set (never the token). */
  remote?: { url: string; hasToken: boolean } | null;
  /** More folders the agents may use (servers that have them; admin devices change them). */
  extraFolders?: string[];
  canEdit: boolean;
}

const MODES = [
  { id: 'default', name: 'Ask', sub: 'Asks before anything not allowed below' },
  { id: 'acceptEdits', name: 'Accept edits', sub: 'Edits inside the project without asking' },
  { id: 'plan', name: 'Plan', sub: 'Reads and plans; changes nothing' },
  { id: 'auto', name: 'Auto', sub: 'Goes ahead; asks only for risky things' },
];
/** Plain names for the server's roles; the server's own label for any other. */
const ROLE_LABEL: Record<string, { label: string; sub: string }> = {
  pm: { label: 'Talking and planning', sub: "This project's threads" },
  dev: { label: 'Building', sub: 'Work handed off from a thread' },
  tester: { label: 'Checking', sub: 'Reviews and tests of that work' },
};
const lines = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
export type GroupId = 'general' | 'models' | 'permissions' | 'tools' | 'budget' | 'github';

/** The form's values (what the person has typed), one field per input. */
export interface Draft {
  name: string; instructions: string;
  models: Record<string, string>; allProviders: boolean; order: string[];
  planFirst: boolean; mode: string; allowAuto: boolean; allowText: string; denyText: string;
  tools: string[]; folders: string; repoMcp: boolean; repoApproved: string[];
  budget: string; warnAt: string;
  remoteUrl: string; remoteToken: string;
}

/** The form's values for a project as the server has it. */
export function draftOf(v: ProjectView): Draft {
  return {
    name: v.name, instructions: v.instructions ?? '',
    models: Object.fromEntries(v.roles.map((r) => [r.role, r.model ?? ''])), allProviders: v.providers === null, order: v.providers ?? v.availableProviders.map((p) => p.name),
    planFirst: v.planFirst, mode: v.permissions?.mode ?? 'default', allowAuto: !!v.permissions?.allowAuto,
    allowText: (v.permissions?.allow ?? []).join('\n'), denyText: (v.permissions?.deny ?? []).join('\n'),
    tools: v.tools, folders: (v.extraFolders ?? []).join('\n'), repoMcp: !!v.repoMcp?.enabled, repoApproved: v.repoMcp?.approved ?? [],
    budget: v.budget ? String(v.budget.monthlyUsd) : '', warnAt: v.budget ? String(Math.round(v.budget.warnAt * 100)) : '80',
    remoteUrl: v.remote?.url ?? '', remoteToken: '',
  };
}

/** Which draft fields belong to which group (a saved group is refilled from the server, the others keep their edits). */
const FIELDS: Record<GroupId, (keyof Draft)[]> = {
  general: ['name', 'instructions'],
  models: ['models', 'allProviders', 'order'],
  permissions: ['planFirst', 'mode', 'allowAuto', 'allowText', 'denyText'],
  tools: ['tools', 'folders', 'repoMcp', 'repoApproved'],
  budget: ['budget', 'warnAt'],
  github: ['remoteUrl', 'remoteToken'],
};

/**
 * What a group's Save sends: the same fields, built the same way, as the single Save sent for them before (fields
 * that only went out when changed still only go out when changed).
 */
export function groupUpdate(g: GroupId, d: Draft, v: ProjectView, git: boolean): Record<string, unknown> {
  switch (g) {
    case 'general': return { name: d.name, ...(v.instructions !== null ? { instructions: d.instructions } : {}) };
    case 'models': {
      const m: Record<string, string | null> = {};
      for (const r of v.roles) m[r.role] = d.models[r.role]?.trim() || null;
      return { models: m, providers: d.allProviders ? null : d.order };
    }
    case 'permissions': return { planFirst: d.planFirst, ...(v.permissions ? { permissions: {
      mode: d.mode === 'auto' && !d.allowAuto ? 'default' : d.mode, allow: lines(d.allowText), deny: lines(d.denyText),
      ...(d.allowAuto !== !!v.permissions.allowAuto ? { allowAuto: d.allowAuto } : {}) } } : {}) };
    case 'tools': return {
      ...(v.toolChoices && d.tools.join() !== v.tools.join() ? { tools: d.tools } : {}),
      ...(v.extraFolders && lines(d.folders).join('\n') !== v.extraFolders.join('\n') ? { extraFolders: lines(d.folders) } : {}),
      ...(v.repoMcp && (d.repoMcp !== v.repoMcp.enabled || d.repoApproved.join() !== v.repoMcp.approved.join()) ? { repoMcp: d.repoMcp, repoMcpApproved: d.repoApproved } : {}) };
    case 'budget': return v.monthCost !== undefined ? { budget: d.budget.trim() ? { monthlyUsd: Number(d.budget), warnAt: Number(d.warnAt) / 100 } : null } : {};
    case 'github': return git && (d.remoteUrl.trim() !== (v.remote?.url ?? '') || d.remoteToken) ? { remote: d.remoteUrl.trim() ? { url: d.remoteUrl.trim(), ...(d.remoteToken ? { token: d.remoteToken } : {}) } : null } : {};
  }
}

/** Whether a group differs from what the server has (its Save is on only then). */
export function groupDirty(g: GroupId, d: Draft, v: ProjectView): boolean {
  const base = draftOf(v);
  return FIELDS[g].some((k) => {
    if (k === 'allowText' || k === 'denyText' || k === 'folders') return lines(d[k]).join('\n') !== lines(base[k]).join('\n');
    if (k === 'remoteToken') return !!d.remoteToken;
    if (k === 'order') return !d.allProviders && d.order.join() !== base.order.join();
    if (k === 'warnAt') return !!d.budget.trim() && d.warnAt !== base.warnAt;
    if (k === 'models') return v.roles.some((r) => (d.models[r.role] ?? '').trim() !== (r.model ?? ''));
    return JSON.stringify(d[k]) !== JSON.stringify(base[k]);
  });
}

/** After a group saves: its fields from the server's answer, every other field as the person left it. */
export function refill(d: Draft, v: ProjectView, g: GroupId): Draft {
  const fresh = draftOf(v);
  const next = { ...d } as Record<keyof Draft, unknown>;
  for (const k of FIELDS[g]) next[k] = fresh[k];
  return next as unknown as Draft;
}

export function ProjectSettings({ project, request, extensions = [], clients = [] }: { project: string; request: Request; extensions?: string[]; /** Client names in use, for the Client picker. */ clients?: string[] }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<GroupId | null>(null);
  const [saved, setSaved] = useState<GroupId | null>(null);
  const [errs, setErrs] = useState<Partial<Record<GroupId, string>>>({});
  const git = extensions.includes('git');

  useEffect(() => {
    setView(null); setD(null); setErr(null); setSaved(null); setErrs({});
    request<ProjectView>('_hearth/project', { project }).then((v) => { setView(v); setD(draftOf(v)); }, (e) => setErr(errorText(e)));
  }, [project, request]);

  if (!view || !d) return <div className="p-6">{err ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{err}</p> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading…</div>}</div>;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => (cur ? { ...cur, [k]: v } : cur));
  const save = async (g: GroupId) => {
    setBusy(g); setSaved(null); setErrs((e) => ({ ...e, [g]: undefined }));
    try {
      const v = await request<ProjectView>('_hearth/project/update', { project, ...groupUpdate(g, d, view, git) });
      setView(v); setD((cur) => (cur ? refill(cur, v, g) : draftOf(v))); setSaved(g);
    } catch (e) { setErrs((x) => ({ ...x, [g]: errorText(e) })); } finally { setBusy(null); }
  };
  const group = (g: GroupId) => ({ dirty: groupDirty(g, d, view), busy: busy === g, saved: saved === g, err: errs[g], canEdit: view.canEdit, onSave: () => void save(g) });
  const order = d.order;
  const move = (i: number, dir: -1 | 1) => { const n = [...order]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set('order', n); };
  const toggle = (name: string) => set('order', order.includes(name) ? order.filter((x) => x !== name) : [...order, name]);
  const listed = [...order, ...view.availableProviders.map((p) => p.name).filter((n) => !order.includes(n))];
  const noProvider = !d.allProviders && order.length === 0;
  const hasTools = !!view.toolChoices || view.tools.length > 0 || !!view.extraFolders || !!view.repoMcp;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-6 max-md:px-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Project settings</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">How this project's agents work. Each part saves on its own; changes apply from the next message or task.</p>
          {!view.canEdit && <p className="mt-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Only an admin device can change these settings. Tick “admin device” for this device on the server's page.</p>}
        </div>

        {view.clientMode === 'simple' && view.kind !== 'assistant' && (
          <ClientLine view={view} clients={clients} canEdit={view.canEdit}
            onSave={async (client) => { const v = await request<ProjectView>('_hearth/project/update', { project, client }); setView(v); }} />
        )}

        <Group title="General" {...group('general')}>
          <Field label="Name"><input value={d.name} onChange={(e) => set('name', e.target.value)} className={field} aria-label="Project name" /></Field>
          <Field label="Instructions" help="What every agent in this project should know, like a project's custom instructions.">
            {view.instructions === null
              ? <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">This server doesn't keep project instructions yet. Until it does, put them in the project's main thread.</p>
              : (
                <>
                  <textarea value={d.instructions} onChange={(e) => set('instructions', e.target.value)} maxLength={8000} aria-label="Project instructions"
                    placeholder="For example: answer in British English; keep changes small; ask before touching the database."
                    className={cn(fieldArea, 'min-h-32 resize-y leading-relaxed')} />
                  <span className="mt-1 block text-right text-xs text-muted-foreground">{d.instructions.length} / 8000</span>
                </>
              )}
          </Field>
        </Group>

        <Group title="Models" sub="Which model each kind of work uses, and which model providers this project may use." {...group('models')}
          note={noProvider ? 'Pick at least one provider.' : undefined} blocked={noProvider}>
          <datalist id="hearth-models">{view.modelChoices.map((m) => <option key={m} value={m} />)}</datalist>
          <Field label="Model for each kind of work" help="Leave one empty for the server's default. A provider without that model uses its closest one.">
            <div className="space-y-2.5">
              {view.roles.map((r) => (
                <label key={r.role} className="grid grid-cols-[12rem_1fr] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
                  <span className="text-sm">{ROLE_LABEL[r.role]?.label ?? r.label}{ROLE_LABEL[r.role] && <span className="block text-xs text-muted-foreground">{ROLE_LABEL[r.role].sub}</span>}</span>
                  <input list="hearth-models" value={d.models[r.role] ?? ''} placeholder={`Default: ${r.default}`} onChange={(e) => set('models', { ...d.models, [r.role]: e.target.value })} className={field} />
                </label>
              ))}
            </div>
          </Field>
          <Field label="Model providers" help={view.client ? 'A client project only uses providers marked OK for client work.' : 'Tried in this order; when one is down, the next takes over.'}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.allProviders} onChange={(e) => set('allProviders', e.target.checked)} className="size-4 accent-primary" />
              Any provider, in the server's order
            </label>
            {!d.allProviders && (
              <ul className="mt-2.5 divide-y rounded-xl border bg-card">
                {listed.map((n) => {
                  const on = order.includes(n);
                  const i = order.indexOf(n);
                  const p = view.availableProviders.find((x) => x.name === n);
                  return (
                    <li key={n} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <input type="checkbox" checked={on} onChange={() => toggle(n)} aria-label={`Use ${n}`} className="size-4 accent-primary" />
                      {on && <span className="grid size-5 place-items-center rounded-md bg-muted text-[11px] font-semibold">{i + 1}</span>}
                      <span className={cn('font-medium', !on && 'text-muted-foreground')}>{n}</span>
                      <span className="text-xs text-muted-foreground">{p ? (p.kind === 'anthropic' ? 'Anthropic API' : 'OpenAI-style API') : 'not available to this project'}</span>
                      {on && (
                        <span className="ml-auto flex gap-0.5">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${n} up`} className="grid size-6 place-items-center rounded-md hover:bg-accent disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${n} down`} className="grid size-6 place-items-center rounded-md hover:bg-accent disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>
        </Group>

        <Group title={view.permissions ? 'Permissions' : 'Planning'} sub={view.permissions ? 'What the agents may do without asking you first. A thread can switch its own mode; “Always allow” on a prompt adds a rule here or to that thread.' : undefined} {...group('permissions')}>
          {view.permissions && (
            <>
              <Field label="New threads start in">
                <div role="radiogroup" aria-label="Mode new threads start in" className={cn('grid gap-2 max-sm:grid-cols-1', d.allowAuto ? 'grid-cols-4' : 'grid-cols-3')}>
                  {MODES.filter((m) => m.id !== 'auto' || d.allowAuto).map((m) => (
                    <button type="button" key={m.id} role="radio" aria-checked={d.mode === m.id} onClick={() => set('mode', m.id)}
                      className={cn('rounded-xl border bg-card px-3 py-2 text-left text-sm hover:bg-accent', d.mode === m.id && 'border-primary ring-2 ring-primary/20')}>
                      <span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.sub}</span>
                    </button>
                  ))}
                </div>
                {!view.client && (
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={d.allowAuto} onChange={(e) => set('allowAuto', e.target.checked)} className="mt-0.5 size-4 accent-primary" />
                    <span>Allow auto mode<span className="block text-xs text-muted-foreground">Threads may then go ahead without asking, except for risky things: the network, deleting, secrets and git history. Every call is still checked on the machine.</span></span>
                  </label>
                )}
              </Field>
              <Field label="Also allowed without asking (one rule per line)" help="A rule names a tool, and for a command what it starts with: Bash(npm test:*) runs npm test, WebFetch(domain:docs.example.com) reads that site.">
                <textarea value={d.allowText} onChange={(e) => set('allowText', e.target.value)} rows={4} spellCheck={false} aria-label="Also allowed without asking"
                  placeholder={'Bash(npm test:*)\nWebFetch(domain:docs.example.com)\nmcp__server__tool'} className={cn(fieldArea, 'font-mono text-xs')} />
              </Field>
              <Field label="Never allowed (one rule per line)">
                <textarea value={d.denyText} onChange={(e) => set('denyText', e.target.value)} rows={3} spellCheck={false} aria-label="Never allowed"
                  placeholder="Bash(curl:*)" className={cn(fieldArea, 'font-mono text-xs')} />
                <p className="mt-1.5 text-xs text-muted-foreground">Always allowed: <span className="font-mono">{view.permissions.defaults.join(', ')}</span>. Always refused: <span className="font-mono">{view.permissions.alwaysDenied.join(', ')}</span>.</p>
              </Field>
            </>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={d.planFirst} onChange={(e) => set('planFirst', e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>Plan before building<span className="block text-xs text-muted-foreground">Work handed off from a thread starts with a written plan for your OK.</span></span>
          </label>
        </Group>

        {hasTools && (
          <Group title="Tools and folders" sub="The connectors this project's agents get, and folders beyond the project's own." {...group('tools')} hideSave={!view.toolChoices && !view.extraFolders && !view.repoMcp}>
            {view.toolChoices ? (
              <Field label="Connectors" help="Add more in Settings > Connectors.">
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...view.toolChoices, ...d.tools])].map((t) => (
                    <button type="button" key={t} aria-pressed={d.tools.includes(t)} onClick={() => set('tools', d.tools.includes(t) ? d.tools.filter((y) => y !== t) : [...d.tools, t])}
                      className={cn('flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs', d.tools.includes(t) ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent')}>
                      <Wrench className="size-3" />{t}{d.tools.includes(t) && <Check className="size-3" />}
                    </button>
                  ))}
                </div>
              </Field>
            ) : view.tools.length > 0 && (
              <Field label="Connectors" help="Set on the server.">
                <div className="flex flex-wrap gap-1.5">{view.tools.map((t) => <span key={t} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"><Wrench className="size-3" />{t}</span>)}</div>
              </Field>
            )}
            {view.repoMcp && (
              <div className="rounded-lg border p-2.5 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={d.repoMcp} onChange={(e) => set('repoMcp', e.target.checked)} className="mt-0.5 size-4 accent-primary" />
                  <span>Use the repo's own .mcp.json<span className="block text-xs text-muted-foreground">Only servers you allow below. A command runs only once you allow that exact entry, on the machine, as this project's user. Their tools still ask.</span></span>
                </label>
                {d.repoMcp && (view.repoMcp.found.length === 0
                  ? <p className="mt-2 text-xs text-muted-foreground">Nothing found yet: the file is read when a session starts.</p>
                  : <ul className="mt-2 space-y-1">{view.repoMcp.found.map((f) => (
                      <li key={f.hash} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" disabled={!f.usable} checked={d.repoApproved.includes(f.hash)} aria-label={`Allow ${f.name}`}
                          onChange={(e) => set('repoApproved', e.target.checked ? [...d.repoApproved, f.hash] : d.repoApproved.filter((h) => h !== f.hash))} className="size-3.5 accent-primary" />
                        <span className="font-mono">{f.name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{!f.usable ? 'not usable' : f.type === 'stdio' ? `command: ${f.command}` : f.url}</span>
                      </li>))}</ul>)}
              </div>
            )}
            {view.extraFolders && (
              <Field label="Other folders" help="Folders the agents may also read and edit, one per line. They must be on the machine this project runs on.">
                <textarea value={d.folders} onChange={(e) => set('folders', e.target.value)} rows={2} spellCheck={false} aria-label="Other folders"
                  placeholder="/workspace/shared-lib" className={cn(fieldArea, 'font-mono text-xs')} />
              </Field>
            )}
          </Group>
        )}

        {view.monthCost !== undefined && (
          <Group title="Budget" sub={`This month so far: $${view.monthCost.toFixed(2)}. Leave the amount empty for no budget.`} {...group('budget')}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">$<input value={d.budget} onChange={(e) => set('budget', e.target.value)} inputMode="decimal" placeholder="none" aria-label="Monthly budget in US dollars" className={cn(field, 'w-28')} /> a month</label>
              <label className="flex items-center gap-1.5">warn at <input value={d.warnAt} onChange={(e) => set('warnAt', e.target.value)} inputMode="numeric" aria-label="Warning level in percent" className={cn(field, 'w-16')} />%</label>
            </div>
            <p className="text-xs text-muted-foreground">At the warning level you get a note; at the budget, new work in this project stops until you raise it.</p>
          </Group>
        )}

        {git && (
          <Group title="GitHub" sub="Where branches are pushed and pull requests opened. Agents never push; you do it here." {...group('github')}>
            <Field label="Repository">
              <input value={d.remoteUrl} onChange={(e) => set('remoteUrl', e.target.value)} placeholder="https://github.com/owner/repo.git" aria-label="Remote URL" className={cn(field, 'font-mono')} />
            </Field>
            <Field label="Token" help="A fine-grained token for this repository. Stored on the server, never shown again.">
              <input value={d.remoteToken} onChange={(e) => set('remoteToken', e.target.value)} type="password" autoComplete="off" aria-label="Remote token"
                placeholder={view.remote?.hasToken ? 'Token set (type to replace)' : 'Paste a token'} className={field} />
            </Field>
            {view.remote && <PullRequests project={project} request={request} />}
          </Group>
        )}
      </div>
    </div>
  );
}

/** Push a branch and open a pull request; the project's pull requests with their CI. */
function PullRequests({ project, request }: { project: string; request: Request }) {
  const [prs, setPrs] = useState<{ number: number; url: string; branch: string; base: string; state: string; ci: string | null; ci_detail: string | null }[] | null>(null);
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => request<{ prs: NonNullable<typeof prs> }>('_hearth/git/prs', { project }).then((r) => setPrs(r.prs), () => setPrs([]));
  useEffect(() => { void load(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (what: 'push' | 'pr') => {
    setBusy(what); setMsg(null);
    try {
      if (what === 'push') { await request('_hearth/git/push', { project, branch }); setMsg(`Pushed ${branch}.`); }
      else { const r = await request<{ number: number; url: string; existing: boolean }>('_hearth/git/pr', { project, branch, title: title || branch }); setMsg(`${r.existing ? 'Already open' : 'Opened'}: PR #${r.number}`); void load(); }
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="mt-3 rounded-lg border p-2.5 text-sm">
      <div className="flex flex-wrap gap-2">
        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" aria-label="Branch" className={cn(field, 'w-44 font-mono')} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pull request title" aria-label="Pull request title" className={cn(field, 'min-w-40 flex-1')} />
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!branch || !!busy} onClick={() => void go('push')}>{busy === 'push' && <Loader2 className="size-3.5 animate-spin" />}Push</Button>
        <Button type="button" size="sm" disabled={!branch || !!busy} onClick={() => void go('pr')}>{busy === 'pr' && <Loader2 className="size-3.5 animate-spin" />}Push and open PR</Button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      {prs && prs.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {prs.map((p) => (
            <li key={p.number} className="flex items-center gap-2">
              <a href={p.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">#{p.number}</a>
              <span className="font-mono">{p.branch} → {p.base}</span>
              <span className={cn('ml-auto rounded-full px-1.5', p.ci === 'failure' ? 'bg-destructive/15 text-destructive' : p.ci === 'success' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>
                {p.state !== 'open' ? p.state : p.ci === 'failure' ? `CI failed: ${p.ci_detail ?? ''}` : p.ci ?? 'no checks'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** One group of settings: a card with its own Save on the right (the guide's form panel), on only when it changed. */
function Group({ title, sub, children, dirty, busy, saved, err, canEdit, onSave, note, blocked, hideSave }: {
  title: string; sub?: string; children: React.ReactNode; dirty: boolean; busy: boolean; saved: boolean; err?: string; canEdit: boolean; onSave: () => void;
  /** A line beside Save (why it can't save yet). */ note?: string; blocked?: boolean; hideSave?: boolean;
}) {
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-3 space-y-4">{children}</div>
      {err && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{err}</p>}
      {!hideSave && (
        <div className="mt-4 flex items-center justify-end gap-3">
          {note && <span className="mr-auto text-xs text-muted-foreground">{note}</span>}
          {saved && !dirty && <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3.5" />Saved</span>}
          <Button type="button" size="sm" disabled={!dirty || busy || !canEdit || blocked} onClick={onSave}>{busy && <Loader2 className="size-3.5 animate-spin" />}Save</Button>
        </div>
      )}
    </section>
  );
}

/** A field in a group: its label above, help below (the guide's form field). */
/** "Client: Acme. Uses only providers marked OK for client work. [Change]" (simple client mode; admin devices change it). */
function ClientLine({ view, clients, canEdit, onSave }: { view: ProjectView; clients: string[]; canEdit: boolean; onSave: (client: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(view.clientName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await onSave(value.trim()); setEditing(false); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-2xl border bg-card px-4 py-3" aria-label="Client">
      {!editing ? (
        <div className="flex items-center gap-3 text-sm">
          <p className="min-w-0 flex-1">{view.clientName
            ? <><span className="font-medium">Client: {view.clientName}.</span> <span className="text-muted-foreground">Uses only providers marked OK for client work.</span></>
            : <span className="text-muted-foreground">No client: a personal project.</span>}</p>
          {canEdit && <Button type="button" size="sm" variant="outline" onClick={() => { setValue(view.clientName ?? ''); setEditing(true); }}>{view.clientName ? 'Change' : 'Add a client'}</Button>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-medium">Client</div>
          <ClientPicker value={value} onChange={setValue} clients={clients} />
          <p className="text-xs text-muted-foreground">A client project only uses model providers marked OK for client work, from its next message.</p>
          {err && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy || (value.trim() === (view.clientName ?? ''))}>{busy && <Loader2 className="size-3.5 animate-spin" />}Save</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{label}</div>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
