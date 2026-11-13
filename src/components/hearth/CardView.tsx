// A card: something the agent or its workers need from you (a question, a merge approval, a permission). One look for
// all kinds; answered from any window, first answer wins. Once answered it greys out with who answered.
import { useState } from 'react';
import { Check, CircleHelp, GitMerge, Loader2, Send, ShieldQuestion, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Card, type CardAnswer, decidedLine, errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

const ICON: Record<string, typeof CircleHelp> = { question: CircleHelp, review_merge: GitMerge, permission: ShieldQuestion, failure: TriangleAlert };

export function CardView({ card, onAnswer, where, compact }: {
  card: Card;
  onAnswer: (a: CardAnswer) => Promise<unknown>;
  /** A line saying which thread the card is from (needs-you view). */
  where?: React.ReactNode;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const open = card.status === 'open';
  const Icon = ICON[card.kind] ?? CircleHelp;
  const go = async (key: string, a: CardAnswer) => {
    setBusy(key); setErr(null);
    try { await onAnswer(a); } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };
  // Servers often repeat the question in the title ("Question from x: ..."); show it once.
  const why = card.why && !card.title.includes(card.why.trim()) ? card.why : '';
  return (
    <div role="group" aria-label={card.label}
      className={cn('rounded-xl border bg-card text-card-foreground shadow-xs transition-opacity', open ? 'border-primary/30' : 'opacity-60', compact ? 'p-3' : 'p-3.5')}>
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md', open ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground')}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{card.label}</div>
          {where && <div className="text-xs text-muted-foreground">{where}</div>}
          <div className="mt-0.5 text-sm font-medium break-words">{card.title}</div>
          {why && <p className="mt-1 max-h-40 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground">{why}</p>}
          {card.toolCall?.title && card.kind === 'permission' && (
            <code className="mt-1.5 block truncate rounded-md bg-muted px-2 py-1 text-xs">{card.toolCall.title}</code>
          )}
          {!open && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" />{decidedLine(card)}</div>}
          {open && card.answerable === 'text' && (
            <form className="mt-2.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void go('answer', { decision: 'answer', text: text.trim() }); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer" aria-label="Your answer"
                className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
              <Button type="submit" size="sm" disabled={!text.trim() || !!busy}>
                {busy === 'answer' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Send
              </Button>
            </form>
          )}
          {open && card.answerable === 'approve_deny' && (
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => void go('approve', { decision: 'approve' })}>
                {busy === 'approve' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{card.kind === 'review_merge' ? 'Approve merge' : 'Approve'}
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void go('deny', { decision: 'deny' })}>
                {busy === 'deny' ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}Deny
              </Button>
            </div>
          )}
          {open && card.answerable === 'permission' && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(card.options ?? []).map((o) => {
                const allow = o.kind.startsWith('allow');
                return (
                  <Button key={o.optionId} size="sm" variant={allow && o.kind === 'allow_once' ? 'default' : 'outline'} disabled={!!busy}
                    onClick={() => void go(o.optionId, { decision: allow ? 'approve' : 'deny', optionId: o.optionId })}>
                    {busy === o.optionId ? <Loader2 className="size-3.5 animate-spin" /> : allow ? <Check className="size-3.5" /> : <X className="size-3.5" />}{o.name}
                  </Button>
                );
              })}
            </div>
          )}
          {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        </div>
      </div>
    </div>
  );
}
