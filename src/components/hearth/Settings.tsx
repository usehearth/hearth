// Settings: servers and this device's key, the server's model providers (read-only here, with health and a Test),
// and appearance. Channels come when the server has them. Nothing here is chat content; keys are never shown.
import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, KeyRound, Laptop, Loader2, MoonStar, Palette, Pencil, Plus, Radio, RefreshCw, Server as ServerIcon, Sparkles, Sun, Trash2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KeyPrompt } from '@/components/hearth/AddServer';
import type { DirectoryState } from '@/lib/directory';
import { forgetKey, isDesktop, keyFor, removeServer, renameServer, type Server } from '@/lib/servers';
import { setThemeMode, useThemeMode, type ThemeMode } from '@/lib/theme';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

type Section = 'servers' | 'providers' | 'appearance';

export function Settings({ servers, server, dir, onAdd, onUse, onKeyChanged }: {
  servers: Server[];
  server?: Server;
  dir: DirectoryState;
  onAdd: () => void;
  onUse: (id: string) => void;
  onKeyChanged: () => void;
}) {
  const [section, setSection] = useState<Section>('servers');
  const nav: { id: Section; label: string; icon: typeof ServerIcon }[] = [
    { id: 'servers', label: 'Servers and keys', icon: ServerIcon },
    { id: 'providers', label: 'Model providers', icon: Sparkles },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ];
  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <nav aria-label="Settings sections" className="w-52 shrink-0 space-y-0.5 border-r p-3 max-md:flex max-md:w-auto max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto max-md:border-r-0 max-md:border-b">
        {nav.map((n) => (
          <button key={n.id} onClick={() => setSection(n.id)} aria-current={section === n.id ? 'page' : undefined}
            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap hover:bg-accent max-md:w-auto', section === n.id && 'bg-accent font-medium')}>
            <n.icon className="size-4 text-muted-foreground" />{n.label}
          </button>
        ))}
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground/70" title="Coming when the server has channels">
          <Radio className="size-4" />Channels <span className="text-[10px] uppercase tracking-wider">soon</span>
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 max-md:px-4">
          {section === 'servers' && <Servers servers={servers} server={server} dir={dir} onAdd={onAdd} onUse={onUse} onKeyChanged={onKeyChanged} />}
          {section === 'providers' && <Providers dir={dir} server={server} />}
          {section === 'appearance' && <Appearance />}
        </div>
      </div>
    </div>
  );
}

function H({ title, sub }: { title: string; sub?: string }) {
  return (<div className="mb-4"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}</div>);
}

// ---------- servers and keys ----------

function Servers({ servers, server, dir, onAdd, onUse, onKeyChanged }: { servers: Server[]; server?: Server; dir: DirectoryState; onAdd: () => void; onUse: (id: string) => void; onKeyChanged: () => void }) {
  const [device, setDevice] = useState<{ name: string; workDevice: boolean } | null>(null);
  const ready = dir.state === 'ready' ? dir : null;
  useEffect(() => {
    setDevice(null);
    if (ready?.extensions.includes('device')) void ready.request<{ name: string; workDevice: boolean }>('_hearth/device').then(setDevice, () => {});
  }, [ready?.request]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <H title="Servers and keys" sub="Hearth remembers each server's address and name. Its device key lives in your system keychain on the desktop, or in memory for this window on the web." />
      <div className="space-y-3">
        {servers.map((s) => <ServerRow key={s.id} s={s} current={s.id === server?.id} dir={s.id === server?.id ? dir : undefined}
          device={s.id === server?.id ? device : null} onUse={() => onUse(s.id)} onKeyChanged={onKeyChanged} />)}
      </div>
      <Button variant="outline" className="mt-4" onClick={onAdd}><Plus className="size-4" />Add a server</Button>
      <p className="mt-6 text-xs text-muted-foreground">Device keys are made and revoked on the server. Revoking one there disconnects it here at once.</p>
    </>
  );
}

function ServerRow({ s, current, dir, device, onUse, onKeyChanged }: { s: Server; current: boolean; dir?: DirectoryState; device: { name: string; workDevice: boolean } | null; onUse: () => void; onKeyChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const hasKey = !!keyFor(s.id);
  const state = dir?.state === 'ready' ? (dir.reconnecting ? 'Reconnecting' : `Connected to ${dir.agent}`) : dir?.state === 'error' ? 'Not connected' : dir?.state === 'no-key' ? 'Needs its key' : dir ? 'Connecting' : null;
  return (
    <div className={cn('rounded-xl border bg-card p-4', current && 'border-primary/40')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><ServerIcon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); renameServer(s.id, name); setEditing(false); }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Server name" className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm" />
              <Button size="sm" type="submit"><Check className="size-3.5" />Save</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => { setName(s.name); setEditing(false); }}><X className="size-3.5" /></Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{s.name}</span>
              {current && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">In use</span>}
              <button onClick={() => setEditing(true)} aria-label={`Rename ${s.name}`} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil className="size-3" /></button>
            </div>
          )}
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{s.url}</div>
          <dl className="mt-2.5 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            {state && <><dt className="text-muted-foreground">Status</dt><dd>{state}</dd></>}
            <dt className="text-muted-foreground">Device key</dt>
            <dd className="flex items-center gap-1.5">{hasKey ? <><KeyRound className="size-3.5 text-muted-foreground" />{isDesktop ? 'In the system keychain' : 'In memory for this window'}</> : <span className="text-muted-foreground">Not set</span>}</dd>
            {device && <><dt className="text-muted-foreground">This device</dt><dd className="flex items-center gap-1.5"><Laptop className="size-3.5 text-muted-foreground" />{device.name}{device.workDevice && <span className="text-xs text-muted-foreground">· work device</span>}</dd></>}
          </dl>
          {keyOpen && <div className="-mx-1"><KeyPrompt server={s} onSaved={() => { setKeyOpen(false); onKeyChanged(); }} /></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!current && <Button size="sm" onClick={onUse}>Use this server</Button>}
            <Button size="sm" variant="outline" onClick={() => setKeyOpen((o) => !o)}><KeyRound className="size-3.5" />{hasKey ? 'Replace key' : 'Add key'}</Button>
            {hasKey && <Button size="sm" variant="outline" onClick={() => { forgetKey(s.id); onKeyChanged(); }}>Forget key</Button>}
            {confirm ? (
              <span className="flex items-center gap-2 text-sm">Remove {s.name} from this device?
                <Button size="sm" variant="destructive" onClick={() => removeServer(s.id)}>Remove</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
              </span>
            ) : <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}><Trash2 className="size-3.5" />Remove</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- model providers ----------

interface ProviderRow {
  name: string; kind: string; base_url: string; key_ref: string | null; has_key: boolean;
  models: { default?: string; strong?: string; fast?: string };
  priority: number; enabled: boolean; sensitive_ok: boolean;
  status: 'ok' | 'down' | 'off'; down_until: string | null; last_error: string | null; last_ok: string | null;
}

function Providers({ dir, server }: { dir: DirectoryState; server?: Server }) {
  const ready = dir.state === 'ready' ? dir : null;
  const supported = !!ready?.extensions.includes('providers');
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!ready || !supported) return;
    setErr(null);
    ready.request<{ providers: ProviderRow[] }>('_hearth/providers').then((r) => setRows(r.providers ?? []), (e) => setErr(errorText(e)));
  }, [ready?.request, supported]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return (
    <>
      <H title="Model providers" sub="Where the server's agents get their thinking, in the order it tries them. When one is down, new work moves to the next." />
      {!ready && <p className="text-sm text-muted-foreground">Connect to a server to see its providers.</p>}
      {ready && !supported && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{server?.name ?? 'This server'} doesn't share its providers with Hearth. They are set on the server itself.</p>}
      {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      {ready && supported && !rows && !err && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {rows && rows.length === 0 && <p className="rounded-xl border bg-card p-4 text-sm">No providers yet: the server waits until one is added.</p>}
      {rows && rows.length > 0 && (
        <>
          <div className="space-y-3">{rows.map((p, i) => <ProviderCard key={p.name} p={p} n={i + 1} test={(name) => ready!.request<{ ok: boolean; status?: number; error?: string; ms: number }>('_hearth/providers/test', { name })} onTested={load} />)}</div>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="size-3.5" />Refresh</Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Keys are never shown, only whether one is set. Providers are added and changed by the server's owner on the server; this device can view and test them.</p>
        </>
      )}
    </>
  );
}

function ProviderCard({ p, n, test, onTested }: { p: ProviderRow; n: number; test: (name: string) => Promise<{ ok: boolean; status?: number; error?: string; ms: number }>; onTested: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const run = async () => {
    setBusy(true); setResult(null);
    try { const r = await test(p.name); setBad(!r.ok); setResult(r.ok ? `Answered in ${r.ms} ms` : `Failed: ${r.error ?? r.status}`); onTested(); }
    catch (e) { setBad(true); setResult(errorText(e)); } finally { setBusy(false); }
  };
  const pill = p.status === 'ok' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : p.status === 'down' ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground';
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold" title="Order tried">{n}</span>
        <span className="font-medium">{p.name}</span>
        <span className="text-xs text-muted-foreground">{p.kind === 'anthropic' ? 'Anthropic API' : 'OpenAI-style API'}</span>
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium', pill)}>{p.status === 'ok' ? 'Up' : p.status === 'down' ? 'Down' : 'Off'}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Address</dt><dd className="truncate font-mono text-xs leading-5">{p.base_url}</dd>
        <dt className="text-muted-foreground">Key</dt><dd>{p.has_key ? 'Set' : <span className="text-destructive">Missing</span>}</dd>
        <dt className="text-muted-foreground">Models</dt>
        <dd className="text-xs leading-5">{[['default', p.models.default], ['strong', p.models.strong], ['fast', p.models.fast]].filter(([, m]) => m).map(([k, m]) => <span key={k} className="mr-2 inline-block"><span className="text-muted-foreground">{k}</span> {m}</span>)}</dd>
        <dt className="text-muted-foreground">Client work</dt><dd>{p.sensitive_ok ? 'Allowed' : 'Personal projects only'}</dd>
        {p.last_ok && <><dt className="text-muted-foreground">Last answer</dt><dd>{new Date(p.last_ok).toLocaleString()}</dd></>}
        {p.status === 'down' && p.last_error && <><dt className="text-muted-foreground">Last error</dt><dd className="flex gap-1.5 text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span className="break-words">{p.last_error}</span></dd></>}
      </dl>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}Test</Button>
        {result && <span className={cn('text-sm', bad ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400')}>{result}</span>}
      </div>
    </div>
  );
}

// ---------- appearance ----------

function Appearance() {
  const mode = useThemeMode();
  const opts: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: 'Match the system', icon: Laptop }, { id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: MoonStar },
  ];
  return (
    <>
      <H title="Appearance" sub="Remembered on this device." />
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
        {opts.map((o) => (
          <button key={o.id} role="radio" aria-checked={mode === o.id} onClick={() => setThemeMode(o.id)}
            className={cn('flex items-center gap-2 rounded-xl border bg-card px-3 py-3 text-sm hover:bg-accent', mode === o.id && 'border-primary ring-2 ring-primary/20')}>
            <o.icon className="size-4 text-muted-foreground" />{o.label}
          </button>
        ))}
      </div>
    </>
  );
}
