// New project (admin devices only, `_hearth/project/create`): a name, the machine it runs on, its folder there, and
// (on a work device) a client. The server wires its tools and opens its main thread.
import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/hearth';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
interface Options { pools: { name: string; title: string; clientOk: boolean }[]; defaultPool: string; clientAllowed: boolean }
export interface Made { slug: string; name: string; client: boolean; sessionId: string; cwd: string; tools: { ok: boolean; error?: string } }

const slugFrom = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

export function NewProject({ request, onDone }: { request: Request; onDone: (m: Made) => void }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [pool, setPool] = useState('');
  const [path, setPath] = useState('');
  const [client, setClient] = useState('');
  useEffect(() => {
    request<Options>('_hearth/project/options').then((o) => { setOpts(o); setPool(o.defaultPool); }, (e) => setErr(errorText(e)));
  }, [request]);

  const poolInfo = opts?.pools.find((p) => p.name === pool);
  const clientBlocked = !!client.trim() && poolInfo && !poolInfo.clientOk;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onDone(await request<Made>('_hearth/project/create', { name, slug: slugTouched ? slug : slugFrom(name), pool, path, ...(client.trim() ? { client } : {}) })); }
    catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };

  if (!opts) return <div className="p-6">{err ? <p className="text-sm text-destructive">{err}</p> : <Loader2 className="size-4 animate-spin text-muted-foreground" />}</div>;
  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={submit} className="mx-auto max-w-xl space-y-5 px-6 py-6 max-md:px-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">New project</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">A project is a folder on one of your machines, with its own threads, tools and settings.</p>
        </div>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus className={inputCls} placeholder="Garden planner" />
        </Field>
        <Field label="Short name" sub="Used in links and tool names: lowercase letters, digits and dashes.">
          <input value={slugTouched ? slug : slugFrom(name)} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} pattern="[a-z0-9][a-z0-9\-]{0,39}" className={inputCls} />
        </Field>
        <Field label="Runs on">
          <select value={pool} onChange={(e) => setPool(e.target.value)} className={inputCls}>
            {opts.pools.map((p) => <option key={p.name} value={p.name}>{p.title}{p.title !== p.name ? ` (${p.name})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Folder on that machine" sub="Where the agents work. Leave empty to set it later on the page.">
          <input value={path} onChange={(e) => setPath(e.target.value)} className={inputCls} placeholder="C:\Projects\garden-planner" />
        </Field>
        {opts.clientAllowed && (
          <Field label="Client" sub="Leave empty for a personal project. Client work stays on machines that allow it.">
            <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={60} className={inputCls} />
            {clientBlocked && <p className="mt-1 text-xs text-destructive">{poolInfo?.title} doesn't take client work: pick another machine.</p>}
          </Field>
        )}
        <div className="flex items-center gap-3 border-t pt-4">
          <Button type="submit" disabled={busy || !name.trim() || !!clientBlocked}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Make project</Button>
          {err && <span className="text-sm text-destructive">{err}</span>}
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      {sub && <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
