// Settings, Import (docs/import.md): every import's receipt, as the server counted and kept it. Open one to see
// every source and every thing not kept, and save it. The button starts the guided import.
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, CircleAlert, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImportReceipt } from '@/components/hearth/ImportReceipt';
import { SectionHead } from '@/components/hearth/ServerSettings';
import { errorText } from '@/lib/hearth';
import { countsLine, type Receipt, type ReceiptSummary } from '@/lib/receipt';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
const n = (x: number) => x.toLocaleString('en-GB');
const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ImportHistory({ request, serverName, onStart }: { request: Request; serverName: string; onStart: () => void }) {
  const [list, setList] = useState<ReceiptSummary[] | null>(null);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  useEffect(() => { request<{ receipts: ReceiptSummary[] }>('_hearth/import/receipts', { limit: 50 }).then((r) => setList(r.receipts), (e) => { setList([]); setError(errorText(e)); }); }, [request]);
  const show = async (runId: number) => {
    setLoading(runId);
    try { setOpen((await request<{ receipt: Receipt }>('_hearth/import/receipt', { runId })).receipt); } catch (e) { setError(errorText(e)); } finally { setLoading(null); }
  };
  if (open) {
    return (
      <div>
        <Button size="sm" variant="ghost" className="mb-3 -ml-2" onClick={() => setOpen(null)}><ArrowLeft className="size-3.5" />All imports</Button>
        <SectionHead title={`Import of ${at(open.at)}`} sub={`By ${open.by}. Counted by ${serverName} from what it stored.`} />
        <ImportReceipt receipt={open} serverName={serverName} />
      </div>
    );
  }
  return (
    <div>
      <SectionHead title="Import from Claude" sub="Bring your Claude Code conversations, claude.ai chats and memories, and your skills and plugins. Each import leaves a receipt here: what was found, kept, already here, and not kept, and why."
        action={<Button size="sm" onClick={onStart}><Download className="size-3.5" />Bring everything from Claude</Button>} />
      {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error}</p>}
      {!list && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading…</p>}
      {list && !list.length && <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No imports yet. Bring everything from Claude to make the first one.</p>}
      {list && list.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((r) => (
            <li key={r.runId}>
              <button type="button" onClick={() => void show(r.runId)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40">
                {r.totals.notKept ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-text" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{at(r.at)}</span>
                  <span className="block text-xs tabular-nums">{countsLine(r.totals)}{r.sinceLast ? (r.sinceLast.new ? ` · ${n(r.sinceLast.new)} new since the import before` : ' · nothing new since the import before') : ''}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.sources.map((s) => `${s.label}: ${n(s.kept + s.here)} of ${n(s.found)}`).join(' · ')}</span>
                </span>
                {loading === r.runId ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
