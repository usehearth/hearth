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
