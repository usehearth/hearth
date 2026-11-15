// Needs you: every open card across the server's threads, oldest first, each answerable here or opened in its thread.
// Generic: it is just the cards (`_hearth/cards`).
import { ArrowUpRight, Inbox } from 'lucide-react';
import { CardView } from '@/components/hearth/CardView';
import type { CardAnswer, CardEntry } from '@/lib/hearth';
import { AdminFlags } from '@/components/hearth/Admin';

export function NeedsYou({ cards, onAnswer, onOpen, onOpenAdmin, adminRequest, onOpenThread }: {
  cards: CardEntry[];
  onAnswer: (e: CardEntry, a: CardAnswer) => Promise<unknown>;
  onOpen: (e: CardEntry) => void;
  /** "Open in admin" on a blocked card (set only where this install can open admin threads). */
  onOpenAdmin?: (e: CardEntry) => void;
  /** Servers with admin threads: their "worth a look" flags show here too. */
  adminRequest?: <T = unknown>(method: string, params?: unknown) => Promise<T>;
  onOpenThread?: (sessionId: string, title: string) => void;
}) {
  const flags = adminRequest && onOpenThread ? <AdminFlags request={adminRequest} onOpen={onOpenThread} /> : null;
  if (!cards.length) {
    // Admin flags (when any) above the usual empty state; the flags section draws nothing when there are none.
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        {flags && <div className="mx-auto w-full max-w-2xl px-5 pt-6 max-md:px-4">{flags}</div>}
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto size-10 text-muted-foreground/60" />
            <h2 className="mt-3 text-sm font-semibold">No cards waiting</h2>
            <p className="mt-1 text-sm text-muted-foreground">Questions, approvals and permission prompts from any thread show up here.</p>
          </div>
        </div>
      </div>
    );
  }
  // Grouped by thread, in the order their oldest card arrived.
  const byThread = new Map<string, CardEntry[]>();
  for (const e of cards) byThread.set(e.sessionId, [...(byThread.get(e.sessionId) ?? []), e]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6 max-md:px-4">
        {flags}
        <p className="text-sm text-muted-foreground">{cards.length} {cards.length === 1 ? 'thing waits' : 'things wait'} for you. The first answer from any window counts.</p>
        {[...byThread.values()].map((list) => {
          const t = list[0];
          return (
            <section key={t.sessionId} aria-label={t.title}>
              <button onClick={() => onOpen(t)} className="group mb-2 flex items-center gap-1.5 text-left text-sm">
                <span className="font-medium group-hover:underline">{t.kind === 'main' ? 'Main thread' : t.title}</span>
                <span className="text-muted-foreground">· {t.projectName}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
              <div className="space-y-2">
                {list.map((e) => <CardView key={e.card.id} card={e.card} onAnswer={(a) => onAnswer(e, a)} onOpenAdmin={onOpenAdmin ? () => onOpenAdmin(e) : undefined} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
