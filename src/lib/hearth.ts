// Hearth's ACP extensions (`_hearth/*` and `_meta.hearth`), as a server sends them. Plain ACP servers send none of
// this and Hearth still works: no plan panel content, no cards, an empty needs-you view.
//
//   _hearth/plan {sessionId} -> {path, text, note?}            the thread's living plan (markdown), read live
//   _hearth/plan_changed {sessionId}                           (notification) the plan file changed: ask again
//   _hearth/cards {sessionId?} -> {cards: CardEntry[]}         open cards, for one thread or all (needs-you view)
//   _hearth/cards_changed {}                                   (notification) a card opened or was answered
//   _hearth/card/answer {sessionId, itemId, decision, text?, optionId?} -> {card}   first answer wins
//   session/update with _meta.hearth.card                      a card arriving live in a thread (or its answer)

export interface Card {
  id: string;
  kind: string;
  label: string;
  title: string;
  why: string;
  status: string;
  /** 'permission': pick an option; 'approve_deny'; 'text': a typed answer. */
  answerable: 'permission' | 'approve_deny' | 'text' | 'form';
  /** A question the agent asked with a form (answerable 'form'): the message and the JSON schema of its fields. */
  form?: { message: string; schema: unknown };
  createdAt?: string;
  decidedBy?: string | null;
  answer?: string | null;
  toolCall?: { title?: string; rawInput?: unknown } | null;
  options?: { optionId: string; name: string; kind: string }[];
}

export interface CardEntry {
  sessionId: string;
  title: string;
  project: string;
  projectName: string;
  kind: string;
  cwd: string;
  card: Card;
}

export interface Plan { path: string | null; text: string | null; note?: string }

export type CardAnswer = { decision: 'approve' | 'deny' | 'answer'; text?: string; optionId?: string; content?: Record<string, unknown> };

/** Reads a card from a session/update, if it carries one. */
export function cardOf(update: unknown): Card | undefined {
  const c = (update as any)?._meta?.hearth?.card;
  if (!c || typeof c !== 'object' || typeof c.id !== 'string') return undefined;
  return {
    id: c.id,
    kind: String(c.kind ?? 'card'),
    label: String(c.label ?? c.kind ?? 'Card'),
    title: String(c.title ?? ''),
    why: String(c.why ?? ''),
    status: String(c.status ?? 'open'),
    answerable: c.answerable === 'text' || c.answerable === 'permission' ? c.answerable : 'approve_deny',
    decidedBy: c.decidedBy ?? null,
    answer: c.answer ?? null,
  };
}

/** Merges a live card update into a thread's card list: open ones are added or refreshed, answered ones marked. */
export function mergeCard(cards: Card[], c: Card): Card[] {
  const i = cards.findIndex((x) => x.id === c.id);
  if (i === -1) return c.status === 'open' ? [...cards, c] : cards;
  const next = [...cards];
  next[i] = { ...next[i], ...c };
  return next;
}

/** "approved" -> "Approved by zed"; "answered" -> "Answered by zed: Ember". */
export function decidedLine(c: Card): string {
  const what = c.status.charAt(0).toUpperCase() + c.status.slice(1);
  return `${what}${c.decidedBy ? ` by ${c.decidedBy}` : ''}${c.status === 'answered' && c.answer ? `: ${c.answer}` : ''}`;
}

/** Plan panel open or closed, remembered per thread on this device (an id, never content). */
export function planPref(sessionId: string | undefined): 'open' | 'closed' | undefined {
  if (!sessionId) return undefined;
  try { const v = localStorage.getItem(`hearth.plan.${sessionId}`); return v === 'open' || v === 'closed' ? v : undefined; } catch { return undefined; }
}
export function setPlanPref(sessionId: string | undefined, v: 'open' | 'closed') {
  if (!sessionId) return;
  try { localStorage.setItem(`hearth.plan.${sessionId}`, v); } catch { /* private mode */ }
}

export function errorText(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.replace(/^Invalid params:\s*/, '');
}
