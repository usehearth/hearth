// The import receipt, as the app shows it (docs/import.md). The server counts it from what it actually stored
// (hearth-server core/src/importreceipt.ts) and keeps every one; this file only puts it into words: the one line at the
// top, each reason, a file to save, and the copy the setup guide may read. Nothing here decides what was kept.

export type ItemKind = 'conversation' | 'chat' | 'memory' | 'skill' | 'agent' | 'command' | 'output_style' | 'hook' | 'other';
export type Reason = 'empty' | 'secret' | 'client' | 'unreadable' | 'unsupported' | 'skipped' | 'failed' | 'stopped' | 'no_store';
export interface Counts { found: number; kept: number; here: number; notKept: number }
export interface NotKept { kind: ItemKind; title: string; reason: Reason; detail?: string | null; client?: boolean; profile?: string | null }
export interface SourceReceipt extends Counts {
  id: string; kind: 'claude-code' | 'claude-ai' | 'repos' | 'archive'; label: string; detail: string | null;
  byKind: Partial<Record<ItemKind, Counts>>; byProfile?: Record<string, Counts>;
  notKeptItems: NotKept[]; notes: { kind: ItemKind; title: string; note: string }[];
}
export interface Receipt {
  v: 1; runId: number; at: string; by: string; totals: Counts; sources: SourceReceipt[];
  sinceLast: { runId: number; at: string; new: number; changed: number } | null; fresh: number; changed: number;
  check: { ok: boolean; problems: string[] };
}
/** A receipt without names (the server's list of past imports). */
export interface ReceiptSummary { runId: number; at: string; by: string; totals: Counts; sinceLast: Receipt['sinceLast']; fresh: number; changed: number; ok: boolean;
  sources: { id: string; kind: SourceReceipt['kind']; label: string; found: number; kept: number; here: number; notKept: number }[] }

const n = (x: number) => x.toLocaleString('en-GB');
export const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

export const KIND_WORDS: Record<ItemKind, [string, string]> = {
  conversation: ['Claude Code conversation', 'Claude Code conversations'], chat: ['claude.ai chat', 'claude.ai chats'], memory: ['memory', 'memories'],
  skill: ['skill', 'skills'], agent: ['subagent', 'subagents'], command: ['slash command', 'slash commands'], output_style: ['output style', 'output styles'],
  hook: ['hook', 'hooks'], other: ['other part of an export', 'other parts of an export'],
};
export const kindWords = (k: ItemKind, x: number) => plural(x, KIND_WORDS[k][0], KIND_WORDS[k][1]);

export const REASON_WORDS: Record<Reason, string> = {
  empty: 'Empty', secret: 'Held back: looks like it holds a secret', client: 'Held back: names a client', unreadable: "Couldn't be read",
  unsupported: "Hearth can't keep this yet", skipped: 'You chose to leave it out', failed: "Didn't arrive (tried again next time)",
  stopped: 'Not sent: the import was stopped', no_store: 'This server has nowhere to keep it',
};

/** Does every count add up? (The server checks too; the app never shows a receipt that doesn't without saying so.) */
export const adds = (c: Counts) => c.found === c.kept + c.here + c.notKept;
export function addsUp(r: Pick<Receipt, 'totals' | 'sources'>): boolean {
  return adds(r.totals) && r.sources.every((s) => adds(s) && s.notKeptItems.length === s.notKept && Object.values(s.byKind).every((c) => adds(c!)))
    && r.sources.reduce((t, s) => t + s.found, 0) === r.totals.found;
}

/** The one line at the top: "Everything found was kept", or how many were not and where to look. */
export function headline(r: Pick<Receipt, 'totals'>): string {
  const t = r.totals;
  if (!t.found) return 'Nothing was found to bring across.';
  if (!t.notKept) return t.here === t.found ? `Everything found was already here (${plural(t.found, 'thing')}).` : `Everything found was kept (${plural(t.found, 'thing')}).`;
  return `${n(t.notKept)} of ${n(t.found)} ${t.notKept === 1 ? 'was' : 'were'} not kept: see why below.`;
}

/** "12 new since your last import on 18 Nov (3 changed)", or null on a first import. */
export function sinceLastLine(r: Pick<Receipt, 'sinceLast'>): string | null {
  const s = r.sinceLast;
  if (!s) return null;
  const day = new Date(s.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (!s.new && !s.changed) return `Nothing new since your last import on ${day}.`;
  return `${n(s.new)} new since your last import on ${day}${s.changed ? ` (${n(s.changed)} changed)` : ''}.`;
}

/** One source's counts in a line: "Found 412 · kept 400 · already here 10 · not kept 2". */
export const countsLine = (c: Counts) => `Found ${n(c.found)} · kept ${n(c.kept)} · already here ${n(c.here)} · not kept ${n(c.notKept)}`;

/** The receipt as plain text, to save or send. Every source, every count, every thing not kept and why. */
export function receiptText(r: Receipt, serverName = 'your server'): string {
  const lines = [`Hearth import receipt`, `Import ${r.runId} to ${serverName}, ${new Date(r.at).toLocaleString('en-GB')}`, '', headline(r)];
  const since = sinceLastLine(r);
  if (since) lines.push(since);
  lines.push(countsLine(r.totals), '');
  for (const s of r.sources) {
    lines.push(`## ${s.label}`);
    if (s.detail) lines.push(s.detail);
    lines.push(countsLine(s));
    for (const [k, c] of Object.entries(s.byKind)) lines.push(`- ${kindWords(k as ItemKind, c!.found)}: kept ${n(c!.kept)}, already here ${n(c!.here)}, not kept ${n(c!.notKept)}`);
    for (const [p, c] of Object.entries(s.byProfile ?? {})) lines.push(`- From ${p === 'terminal' ? 'the terminal' : `the ${p} profile`}: ${countsLine(c).toLowerCase()}`);
    if (s.notKeptItems.length) {
      lines.push('Not kept:');
      for (const i of s.notKeptItems) lines.push(`- ${i.title} (${KIND_WORDS[i.kind][0]}): ${REASON_WORDS[i.reason]}${i.detail ? `, ${i.detail}` : ''}`);
    }
    for (const x of s.notes) lines.push(`Note: ${x.title}: ${x.note}`);
    lines.push('');
  }
  lines.push(addsUp(r) ? 'Every count adds up: found = kept + already here + not kept.' : 'Warning: these counts do not add up. Please report this.');
  return lines.join('\n');
}

/** The receipt as rows (one per thing not kept, and one line of counts per source), for a spreadsheet. */
export function receiptCsv(r: Receipt): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['source', 'kind', 'title', 'outcome', 'reason', 'detail'].join(',')];
  for (const s of r.sources) {
    rows.push([s.label, 'all', `found ${s.found}`, `kept ${s.kept}, already here ${s.here}, not kept ${s.notKept}`, '', ''].map(q).join(','));
    for (const i of s.notKeptItems) rows.push([s.label, KIND_WORDS[i.kind][0], i.title, 'not kept', REASON_WORDS[i.reason], i.detail ?? ''].map(q).join(','));
  }
  return rows.join('\n') + '\n';
}

/**
 * What the setup guide may read: counts, reasons, and the names of chats, memories, skills and export parts. Nothing
 * that may name a client goes to the guide's model (it may be a third-party service): a client item, an item held
 * back for naming a client, and any Claude Code conversation (its title may be client work) read as "a ...".
 */
export function forGuide(r: Receipt) {
  return {
    runId: r.runId, at: r.at, headline: headline(r), sinceLast: sinceLastLine(r), addsUp: addsUp(r), totals: r.totals,
    sources: r.sources.map((s) => ({
      source: s.label, detail: s.detail, ...pick(s), byKind: s.byKind, byProfile: s.byProfile ?? null,
      notKeptItems: s.notKeptItems.slice(0, 40).map((i) => {
        const hide = i.client || i.reason === 'client' || i.kind === 'conversation';
        return { what: hide ? `a ${i.client || i.reason === 'client' ? 'client ' : ''}${KIND_WORDS[i.kind][0]}` : i.title, kind: i.kind, why: REASON_WORDS[i.reason], detail: hide ? null : i.detail ?? null, profile: i.profile ?? null };
      }),
      moreNotKept: Math.max(0, s.notKeptItems.length - 40),
    })),
  };
}
const pick = (c: Counts): Counts => ({ found: c.found, kept: c.kept, here: c.here, notKept: c.notKept });
