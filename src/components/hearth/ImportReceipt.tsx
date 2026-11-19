// The import receipt (docs/import.md): what the server counted it kept, per source, with every thing not kept named
// and its reason. Shown at the end of an import and reopened from Settings, Import. Words only: src/lib/receipt.ts.
import { useMemo, useState } from 'react';
import { Check, ChevronRight, CircleAlert, Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KIND_WORDS, REASON_WORDS, addsUp, countsLine, headline, kindWords, receiptCsv, receiptText, sinceLastLine, type ItemKind, type Reason, type Receipt, type SourceReceipt } from '@/lib/receipt';
import { cn } from '@/lib/utils';

function save(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function ImportReceipt({ receipt: r, serverName }: { receipt: Receipt; serverName: string }) {
  const ok = addsUp(r) && r.check.ok;
  const since = sinceLastLine(r);
  const day = new Date(r.at).toISOString().slice(0, 10);
  return (
    <section aria-labelledby="receipt-head" className="space-y-4">
      <div className={cn('rounded-xl border p-4', r.totals.notKept ? 'bg-card' : 'border-success/40 bg-success/5')}>
        <h3 id="receipt-head" className="flex items-start gap-2 text-sm font-semibold">
          {r.totals.notKept ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" /> : <Check className="mt-0.5 size-4 shrink-0 text-success" />}
          {headline(r)}
        </h3>
        {since && <p className="mt-1 pl-6 text-sm">{since}</p>}
        <dl className="mt-3 grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {([['Found', r.totals.found], ['Kept', r.totals.kept], ['Already here', r.totals.here], ['Not kept', r.totals.notKept]] as const).map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-background px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-xl font-semibold tabular-nums">{v.toLocaleString('en-GB')}</dd></div>
          ))}
        </dl>
        <p className={cn('mt-2 text-xs', ok ? 'text-muted-foreground' : 'text-destructive')}>
          {ok ? 'Counted by your server from what it stored. Every count adds up: found = kept + already here + not kept.' : 'These counts do not add up. Nothing was deleted, but please report this.'}
        </p>
      </div>
      {r.sources.map((s) => <SourceCard key={s.id} s={s} />)}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => save(`hearth-import-${day}.txt`, receiptText(r, serverName), 'text/plain')}><Download className="size-3.5" />Save the receipt</Button>
        <Button size="sm" variant="outline" onClick={() => save(`hearth-import-${day}.csv`, receiptCsv(r), 'text/csv')}><FileSpreadsheet className="size-3.5" />Save as a spreadsheet</Button>
      </div>
    </section>
  );
}

function SourceCard({ s }: { s: SourceReceipt }) {
  const [open, setOpen] = useState(s.notKept > 0 && s.notKept <= 10);
  // Not-kept things grouped by reason, so 65 artifacts read as one line with a list under it.
  const byReason = useMemo(() => {
    const m = new Map<Reason, SourceReceipt['notKeptItems']>();
    for (const i of s.notKeptItems) m.set(i.reason, [...(m.get(i.reason) ?? []), i]);
    return [...m.entries()];
  }, [s]);
  return (
    <div className="rounded-xl border bg-card">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{s.label}</span>
          {s.notKept === 0 && <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">All kept</span>}
        </div>
        {s.detail && <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>}
        <p className="mt-1 text-xs tabular-nums">{countsLine(s)}</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          {Object.entries(s.byKind).map(([k, c]) => (
            <li key={k} className="tabular-nums">{kindWords(k as ItemKind, c!.found)}: {c!.kept.toLocaleString('en-GB')} kept · {c!.here.toLocaleString('en-GB')} already here · {c!.notKept.toLocaleString('en-GB')} not kept</li>
          ))}
          {Object.entries(s.byProfile ?? {}).map(([p, c]) => (
            <li key={p} className="tabular-nums">From {p === 'terminal' ? 'the terminal' : p === 'Main' ? 'the main Claude app' : `the ${p} profile`}: {c.found.toLocaleString('en-GB')} found, {c.kept.toLocaleString('en-GB')} kept, {c.here.toLocaleString('en-GB')} already here, {c.notKept.toLocaleString('en-GB')} not kept</li>
          ))}
        </ul>
        {s.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs">{s.notes.slice(0, 20).map((n, i) => <li key={i}><span className="font-medium">{n.title}</span>: {n.note}</li>)}</ul>
        )}
      </div>
      {s.notKept > 0 && (
        <div className="border-t">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-sm hover:bg-accent/40">
            <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
            {s.notKept.toLocaleString('en-GB')} not kept, and why
          </button>
          {open && (
            <div className="space-y-3 px-4 pb-3">
              {byReason.map(([reason, items]) => (
                <div key={reason}>
                  <p className="text-xs font-medium">{REASON_WORDS[reason]} ({items.length})</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {items.slice(0, 200).map((i, k) => <li key={k}><span className="text-foreground">{i.title}</span> · {KIND_WORDS[i.kind][0]}{i.detail ? `: ${i.detail}` : ''}</li>)}
                    {items.length > 200 && <li>…and {items.length - 200} more (all of them are in the saved receipt)</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
