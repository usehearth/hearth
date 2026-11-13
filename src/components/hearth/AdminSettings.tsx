// Admin-device settings: add or change model providers and make or revoke device keys. Shown only when the server
// says this device is an admin device (the "admin device" tick on the server's page). Keys are write-only: a provider
// key is sent once and never shown again; a new device key is shown here once, to copy into the other device.
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, Smartphone, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export interface ProviderInput {
  name: string; kind: 'anthropic' | 'openai'; base_url: string; key?: string;
  models: { default?: string; strong?: string; fast?: string }; priority: number; enabled: boolean; sensitive_ok: boolean;
}

/** Add or change one provider. Editing: the name is fixed and an empty key keeps the current one. */
export function ProviderForm({ initial, request, onSaved, onCancel }: {
  initial?: Partial<ProviderInput> & { has_key?: boolean };
  request: Request;
  onSaved: (providers: unknown[]) => void;
  onCancel: () => void;
}) {
  const editing = !!initial?.name;
  const [f, setF] = useState<ProviderInput>({
    name: initial?.name ?? '', kind: (initial?.kind as ProviderInput['kind']) ?? 'anthropic', base_url: initial?.base_url ?? '',
    models: { ...(initial?.models ?? {}) }, priority: initial?.priority ?? 100, enabled: initial?.enabled ?? true, sensitive_ok: initial?.sensitive_ok ?? false,
  });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ProviderInput>(k: K, v: ProviderInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const models = Object.fromEntries(Object.entries(f.models).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v).trim()]));
    try {
      const r = await request<{ providers: unknown[] }>('_hearth/providers/save', { ...f, name: f.name.trim().toLowerCase(), base_url: f.base_url.trim(), models, ...(key ? { key } : {}) });
      setKey('');
      onSaved(r.providers ?? []);
    } catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-primary/40 bg-card p-4" aria-label={editing ? `Change ${f.name}` : 'Add a provider'}>
      <div className="text-sm font-semibold">{editing ? `Change ${f.name}` : 'Add a provider'}</div>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <L label="Name">
          <input required disabled={editing} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="backup" pattern="[a-z0-9-]+" title="lowercase letters, digits and dashes" className={inp} />
        </L>
        <L label="Kind">
          <select value={f.kind} onChange={(e) => set('kind', e.target.value as ProviderInput['kind'])} className={inp}>
            <option value="anthropic">Anthropic API</option>
            <option value="openai">OpenAI-style API</option>
          </select>
        </L>
      </div>
      <L label="Address"><input required value={f.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder={f.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.example.com/v1'} className={inp} /></L>
      <L label="Key" hint={editing ? (initial?.has_key ? 'A key is set. Leave empty to keep it.' : 'No key is set.') : 'Stored encrypted on the server and never shown again.'}>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={editing ? 'Leave empty to keep the current key' : 'Paste the key'} className={inp} />
      </L>
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        {(['default', 'strong', 'fast'] as const).map((k) => (
          <L key={k} label={`Model: ${k}`}><input value={f.models[k] ?? ''} onChange={(e) => set('models', { ...f.models, [k]: e.target.value })} placeholder={f.kind === 'openai' && k === 'default' ? 'required' : 'optional'} className={inp} /></L>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">Order <input type="number" min={0} max={1000} value={f.priority} onChange={(e) => set('priority', Number(e.target.value))} className={cn(inp, 'w-20')} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} className="size-4 accent-(--primary)" />On</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.sensitive_ok} onChange={(e) => set('sensitive_ok', e.target.checked)} className="size-4 accent-(--primary)" />Allowed for client work</label>
      </div>
      {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

interface DeviceRow { id: string; name: string; created_by: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null; current?: boolean }

/** Every device key on the server (never the key): make one for a new device, revoke one. */
export function DeviceKeys({ request }: { request: Request }) {
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { request<{ devices: DeviceRow[] }>('_hearth/devices').then((r) => setRows(r.devices ?? []), (e) => setErr(errorText(e))); }, [request]);
  useEffect(load, [load]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { const r = await request<{ device: { name: string }; key: string }>('_hearth/devices/create', { name: name.trim() }); setMade({ name: r.device.name, key: r.key }); setName(''); load(); }
    catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setErr(null);
    try { const r = await request<{ devices: DeviceRow[] }>('_hearth/devices/revoke', { id }); setRows(r.devices ?? []); setConfirm(null); } catch (e2) { setErr(errorText(e2)); }
  };
  const active = (rows ?? []).filter((d) => !d.revoked_at);
  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold">Device keys</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">This is an admin device, so it can make keys for new devices and revoke old ones. A revoked device is cut off at once.</p>
      {made && (
        <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="font-medium">Key for {made.name}</div>
          <p className="text-xs text-muted-foreground">Copy it into the new device now. It is shown only this once.</p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 text-xs">{made.key}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(made.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMade(null)} aria-label="Hide the key"><X className="size-3.5" /></Button>
          </div>
        </div>
      )}
      <form onSubmit={create} className="mt-3 flex gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="New device name, e.g. phone" aria-label="New device name" maxLength={60} className={cn(inp, 'flex-1')} />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Make a key</Button>
      </form>
      {err && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      {!rows && !err && <Loader2 className="mt-3 size-4 animate-spin text-muted-foreground" />}
      {rows && (
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {active.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.name}</span>{d.current && <span className="ml-1.5 text-xs text-primary">this device</span>}
                <span className="block text-xs text-muted-foreground">{d.last_used_at ? `Last used ${new Date(d.last_used_at).toLocaleString()}` : 'Not used yet'}{d.created_by ? ` · made by ${d.created_by}` : ''}</span>
              </span>
              {!d.current && (confirm === d.id ? (
                <span className="flex items-center gap-1.5">
                  <Button size="sm" variant="destructive" onClick={() => void revoke(d.id)}>Revoke</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                </span>
              ) : <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(d.id)}><Trash2 className="size-3.5" />Revoke</Button>)}
            </li>
          ))}
          {active.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No active keys.</li>}
        </ul>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><KeyRound className="size-3" />The admin and work-device ticks are set on the server's page.</p>
    </div>
  );
}

const inp = 'w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60';

function L({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
