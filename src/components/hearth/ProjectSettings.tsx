// A project's settings: how its agents run. Name, the model per role, which model providers it may use (and in what
// order), plan-first. Instructions show when the server keeps them. Folder, machine and tools are set on the server.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

export interface ProjectView {
  slug: string; name: string; kind: string; client: boolean; agent: string;
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
  permissions?: { mode: string; allow: string[]; deny: string[]; defaults: string[]; alwaysDenied: string[] };
  /** Monthly budget (servers with `usage`), and what this month cost so far. */
  budget?: { monthlyUsd: number; warnAt: number } | null;
  monthCost?: number;
  /** The git remote (servers with `git`): its URL and whether a token is set (never the token). */
  remote?: { url: string; hasToken: boolean } | null;
  canEdit: boolean;
}

const MODES = [
  { id: 'default', name: 'Ask', sub: 'Asks before anything not allowed below' },
  { id: 'acceptEdits', name: 'Accept edits', sub: 'Edits inside the project without asking' },
  { id: 'plan', name: 'Plan', sub: 'Reads and plans; changes nothing' },
];
const lines = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export function ProjectSettings({ project, request, extensions = [] }: { project: string; request: Request; extensions?: string[] }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // The form's state, from the server's view.
  const [name, setName] = useState('');
  const [models, setModels] = useState<Record<string, string>>({});
  const [allProviders, setAllProviders] = useState(true);
  const [order, setOrder] = useState<string[]>([]);
  const [planFirst, setPlanFirst] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [mode, setMode] = useState('default');
  const [allowText, setAllowText] = useState('');
  const [denyText, setDenyText] = useState('');
  const [budget, setBudget] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [repoMcp, setRepoMcp] = useState(false);
  const [repoApproved, setRepoApproved] = useState<string[]>([]);
  const [warnAt, setWarnAt] = useState('80');

  const fill = (v: ProjectView) => {
    setView(v);
    setName(v.name);
    setModels(Object.fromEntries(v.roles.map((r) => [r.role, r.model ?? ''])));
    setAllProviders(v.providers === null);
    setOrder(v.providers ?? v.availableProviders.map((p) => p.name));
    setPlanFirst(v.planFirst);
    setInstructions(v.instructions ?? '');
    setMode(v.permissions?.mode ?? 'default');
    setAllowText((v.permissions?.allow ?? []).join('\n'));
    setDenyText((v.permissions?.deny ?? []).join('\n'));
    setBudget(v.budget ? String(v.budget.monthlyUsd) : '');
    setTools(v.tools);
    setRemoteUrl(v.remote?.url ?? '');
    setRemoteToken('');
    setRepoMcp(!!v.repoMcp?.enabled);
    setRepoApproved(v.repoMcp?.approved ?? []);
    setWarnAt(v.budget ? String(Math.round(v.budget.warnAt * 100)) : '80');
  };
  useEffect(() => {
    setView(null); setErr(null); setSaved(false);
    request<ProjectView>('_hearth/project', { project }).then(fill, (e) => setErr(errorText(e)));
  }, [project, request]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setSaved(false);
    try {
      const m: Record<string, string | null> = {};
      for (const r of view!.roles) m[r.role] = models[r.role]?.trim() || null;
      fill(await request<ProjectView>('_hearth/project/update', { project, name, models: m, providers: allProviders ? null : order, planFirst, ...(view!.instructions !== null ? { instructions } : {}),
        ...(view!.permissions ? { permissions: { mode, allow: lines(allowText), deny: lines(denyText) } } : {}),
        ...(view!.toolChoices && (tools.join() !== view!.tools.join()) ? { tools } : {}),
        ...(extensions.includes('git') && (remoteUrl.trim() !== (view!.remote?.url ?? '') || remoteToken) ? { remote: remoteUrl.trim() ? { url: remoteUrl.trim(), ...(remoteToken ? { token: remoteToken } : {}) } : null } : {}),
        ...(view!.repoMcp && (repoMcp !== view!.repoMcp.enabled || repoApproved.join() !== view!.repoMcp.approved.join()) ? { repoMcp, repoMcpApproved: repoApproved } : {}),
        ...(view!.monthCost !== undefined ? { budget: budget.trim() ? { monthlyUsd: Number(budget), warnAt: Number(warnAt) / 100 } : null } : {}) }));
      setSaved(true);
    } catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };

  if (!view) return <div className="p-6">{err ? <p className="text-sm text-destructive">{err}</p> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}</div>;
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const toggle = (name: string) => setOrder((o) => (o.includes(name) ? o.filter((x) => x !== name) : [...o, name]));
  const listed = [...order, ...view.availableProviders.map((p) => p.name).filter((n) => !order.includes(n))];
  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={save} className="mx-auto max-w-2xl space-y-6 px-6 py-6 max-md:px-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Project settings</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">How this project's agents run. Changes apply to the next turn or task.</p>
        </div>

        <Section title="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="Project name" />
        </Section>

        <Section title="Instructions" sub="What every agent in this project should know, like a project's custom instructions.">
          {view.instructions === null
            ? <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">This server doesn't keep project instructions yet. Until it does, put them in the project's main thread or plan.</p>
            : (
              <>
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={8000} aria-label="Project instructions"
                  placeholder="For example: answer in British English; keep changes small; ask before touching the database."
                  className={cn(inputCls, 'min-h-32 resize-y leading-relaxed')} />
                <span className="mt-1 block text-right text-xs text-muted-foreground">{instructions.length} / 8000</span>
              </>
            )}
        </Section>

        <Section title="Models" sub="Leave empty for the server's default. Providers that don't have a model use their closest one.">
          <datalist id="hearth-models">{view.modelChoices.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="space-y-2.5">
            {view.roles.map((r) => (
              <label key={r.role} className="grid grid-cols-[11rem_1fr] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
                <span className="text-sm">{r.label}</span>
                <input list="hearth-models" value={models[r.role] ?? ''} placeholder={`Default: ${r.default}`} onChange={(e) => setModels((m) => ({ ...m, [r.role]: e.target.value }))} className={inputCls} />
              </label>
            ))}
          </div>
        </Section>

        <Section title="Model providers" sub={view.client ? 'A client project only ever uses providers allowed for client work.' : 'Which providers this project may use, tried in this order.'}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allProviders} onChange={(e) => setAllProviders(e.target.checked)} className="size-4 accent-(--primary)" />
            Any provider, in the server's order
          </label>
          {!allProviders && (
            <ul className="mt-2.5 divide-y rounded-xl border bg-card">
              {listed.map((n) => {
                const on = order.includes(n);
                const i = order.indexOf(n);
                const p = view.availableProviders.find((x) => x.name === n);
                return (
                  <li key={n} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={on} onChange={() => toggle(n)} aria-label={`Use ${n}`} className="size-4 accent-(--primary)" />
                    {on && <span className="grid size-5 place-items-center rounded bg-muted text-[11px] font-semibold">{i + 1}</span>}
                    <span className={cn('font-medium', !on && 'text-muted-foreground')}>{n}</span>
                    <span className="text-xs text-muted-foreground">{p ? (p.kind === 'anthropic' ? 'Anthropic API' : 'OpenAI-style API') : 'not available to this project'}</span>
                    {on && (
                      <span className="ml-auto flex gap-0.5">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${n} up`} className="grid size-6 place-items-center rounded hover:bg-accent disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${n} down`} className="grid size-6 place-items-center rounded hover:bg-accent disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Work">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} className="mt-0.5 size-4 accent-(--primary)" />
            <span>Plan first<span className="block text-xs text-muted-foreground">Workers write a spec for your OK before they build.</span></span>
          </label>
        </Section>

        {extensions.includes('git') && (
          <Section title="Git remote" sub="Where branches are pushed and pull requests opened (GitHub). Agents never push; you do, here. Changing it needs an admin device.">
            <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" aria-label="Remote URL" className={cn(inputCls, 'font-mono')} />
            <input value={remoteToken} onChange={(e) => setRemoteToken(e.target.value)} type="password" autoComplete="off" aria-label="Remote token"
              placeholder={view.remote?.hasToken ? 'Token set (type to replace)' : 'Token (a fine-grained token for this repo)'} className={cn(inputCls, 'mt-2')} />
            {view.remote && <PullRequests project={project} request={request} />}
          </Section>
        )}

        {view.permissions && (
          <Section title="Permissions" sub="What agents may do without asking. Threads can change their own mode; “Always allow” on a prompt adds a rule here (project) or to the thread.">
            <div role="radiogroup" aria-label="Mode new threads start in" className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
              {MODES.map((m) => (
                <button type="button" key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                  className={cn('rounded-xl border bg-card px-3 py-2 text-left text-sm hover:bg-accent', mode === m.id && 'border-primary ring-2 ring-primary/20')}>
                  <span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.sub}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="perm-allow">Also allowed (one rule per line)</label>
            <textarea id="perm-allow" value={allowText} onChange={(e) => setAllowText(e.target.value)} rows={4} spellCheck={false}
              placeholder={'Bash(npm test:*)\nWebFetch(domain:docs.example.com)\nmcp__server__tool'} className={cn(inputCls, 'font-mono text-xs')} />
            <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="perm-deny">Never allowed (one rule per line)</label>
            <textarea id="perm-deny" value={denyText} onChange={(e) => setDenyText(e.target.value)} rows={3} spellCheck={false}
              placeholder="Bash(curl:*)" className={cn(inputCls, 'font-mono text-xs')} />
            <p className="mt-2 text-xs text-muted-foreground">Always allowed: <span className="font-mono">{view.permissions.defaults.join(', ')}</span>. Always refused: <span className="font-mono">{view.permissions.alwaysDenied.join(', ')}</span>.</p>
          </Section>
        )}

        {view.monthCost !== undefined && (
          <Section title="Budget" sub={`This month so far: $${view.monthCost.toFixed(2)}. Leave empty for no budget.`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">$<input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="none" aria-label="Monthly budget in US dollars" className={cn(inputCls, 'w-28')} /> a month</label>
              <label className="flex items-center gap-1.5">warn at <input value={warnAt} onChange={(e) => setWarnAt(e.target.value)} inputMode="numeric" aria-label="Warning level in percent" className={cn(inputCls, 'w-16')} />%</label>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">At the warning level you get a note; at the budget, new work in this project stops until you raise it.</p>
          </Section>
        )}

        {view.toolChoices && (
          <Section title="Tools" sub="The MCP servers this project's agents get (changing them needs an admin device). Add servers in Settings > Connectors.">
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...view.toolChoices, ...tools])].map((t) => (
                <button type="button" key={t} aria-pressed={tools.includes(t)} onClick={() => setTools((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                  className={cn('flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs', tools.includes(t) ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent')}>
                  <Wrench className="size-3" />{t}{tools.includes(t) && <Check className="size-3" />}
                </button>
              ))}
            </div>
            {view.repoMcp && (
              <div className="mt-3 rounded-lg border p-2.5 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={repoMcp} onChange={(e) => setRepoMcp(e.target.checked)} className="mt-0.5 size-4 accent-(--primary)" />
                  <span>Use the repo's own .mcp.json<span className="block text-xs text-muted-foreground">Only servers you allow below, only http ones (a command in the repo never runs), and their tools still ask.</span></span>
                </label>
                {repoMcp && (view.repoMcp.found.length === 0
                  ? <p className="mt-2 text-xs text-muted-foreground">Nothing found yet: the file is read when a session starts.</p>
                  : <ul className="mt-2 space-y-1">{view.repoMcp.found.map((f) => (
                      <li key={f.hash} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" disabled={!f.usable} checked={repoApproved.includes(f.hash)} aria-label={`Allow ${f.name}`}
                          onChange={(e) => setRepoApproved((a) => (e.target.checked ? [...a, f.hash] : a.filter((h) => h !== f.hash)))} className="size-3.5 accent-(--primary)" />
                        <span className="font-mono">{f.name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.usable ? f.url : f.command ? `command: ${f.command} (never run)` : 'not usable'}</span>
                      </li>))}</ul>)}
              </div>
            )}
          </Section>
        )}

        {!view.toolChoices && view.tools.length > 0 && (
          <Section title="Tools" sub="Set on the server.">
            <div className="flex flex-wrap gap-1.5">{view.tools.map((t) => <span key={t} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"><Wrench className="size-3" />{t}</span>)}</div>
          </Section>
        )}

        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
          <Button type="submit" disabled={busy || !view.canEdit || (!allProviders && order.length === 0)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Save</Button>
          {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved</span>}
          {!allProviders && order.length === 0 && <span className="text-sm text-muted-foreground">Pick at least one provider.</span>}
          {err && <span className="text-sm text-destructive">{err}</span>}
        </div>
      </form>
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
        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch" aria-label="Branch" className={cn(inputCls, 'w-44 font-mono')} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pull request title" aria-label="Pull request title" className={cn(inputCls, 'min-w-40 flex-1')} />
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
              <span className={cn('ml-auto rounded px-1.5', p.ci === 'failure' ? 'bg-destructive/15 text-destructive' : p.ci === 'success' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                {p.state !== 'open' ? p.state : p.ci === 'failure' ? `CI failed: ${p.ci_detail ?? ''}` : p.ci ?? 'no checks'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}
