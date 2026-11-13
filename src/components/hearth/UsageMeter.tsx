// How full the thread's context is and what it has cost, from the engine's own usage reports (ACP usage_update).
// A small ring beside the composer; hover or focus for the numbers. Past 80% it suggests /compact.
import { useAcpUsage } from '@/vendor/acp';
import { cn } from '@/lib/utils';

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
export const fmtCost = (c?: { amount: number; currency: string } | null) =>
  c ? new Intl.NumberFormat(undefined, { style: 'currency', currency: c.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: c.amount < 1 ? 3 : 2 }).format(c.amount) : null;

export function UsageMeter() {
  const u = useAcpUsage();
  if (!u || !u.size) return null;
  const pct = Math.min(100, Math.round((u.used / u.size) * 100));
  const cost = fmtCost(u.cost);
  const r = 7, circ = 2 * Math.PI * r;
  const title = `Context ${fmtTokens(u.used)} of ${fmtTokens(u.size)} tokens (${pct}%)${cost ? ` · ${cost} so far` : ''}${pct >= 80 ? ' · /compact frees room' : ''}`;
  return (
    <span tabIndex={0} title={title} aria-label={title}
      className="flex h-7 items-center gap-1.5 rounded-full px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40">
      <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          className={cn(pct >= 90 ? 'stroke-red-500' : pct >= 80 ? 'stroke-amber-500' : 'stroke-primary')} />
      </svg>
      <span className="tabular-nums">{pct}%</span>
      {cost && <span className="tabular-nums max-sm:hidden">· {cost}</span>}
    </span>
  );
}
