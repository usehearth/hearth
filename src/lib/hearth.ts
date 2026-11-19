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
  toolCall?: { title?: string; kind?: string; rawInput?: unknown; content?: unknown; _meta?: unknown } | null;
  options?: { optionId: string; name: string; kind: string }[];
  /** An admin thread's card (a CLIProxyAPI change): answered only with this install's admin key (lib/admin.ts). */
  admin?: { requestId: string; line?: string; reason?: string };
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

/**
 * The plan an agent asks you to approve before it starts work (Claude Code's ExitPlanMode, "Ready to code?"), as
 * markdown. Claude Code's ACP adapter sends it as the call's input (`rawInput.plan`) and repeats it as the call's text
 * content; either is enough. Anything else, including EnterPlanMode (also a `switch_mode` call), has no plan: null.
 */
export function planOf(call: { tool?: string; kind?: string; content?: unknown } | null | undefined, rawInput: unknown): string | null {
  const fromInput = (rawInput as { plan?: unknown } | null)?.plan;
  if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim();
  if (call?.tool !== 'ExitPlanMode') return null;
  const text: string[] = [];
  for (const c of Array.isArray(call.content) ? call.content : []) {
    if ((c as { type?: string })?.type !== 'content') continue;
    const inner = (c as { content?: unknown }).content;
    for (const b of (Array.isArray(inner) ? inner : [inner]) as { type?: string; text?: unknown }[]) if (b?.type === 'text' && typeof b.text === 'string') text.push(b.text);
  }
  return text.join('\n').trim() || null;
}

/** A permission card's plan, when the card asks you to approve one (its tool call is the agent's plan). */
export function cardPlan(card: Pick<Card, 'kind' | 'toolCall'>): string | null {
  if (card.kind !== 'permission' || !card.toolCall) return null;
  const tc = card.toolCall as { rawInput?: unknown; kind?: string; content?: unknown; _meta?: { claudeCode?: { toolName?: string } } };
  // A permission request may not carry the engine's tool name; "Ready to code?" is the only switch_mode that asks.
  const tool = tc._meta?.claudeCode?.toolName ?? (tc.kind === 'switch_mode' ? 'ExitPlanMode' : undefined);
  return planOf({ tool, kind: tc.kind, content: tc.content }, tc.rawInput);
}

export function errorText(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.replace(/^Invalid params:\s*/, '');
}
