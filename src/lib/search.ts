// One search over Hearth's threads and the imported Claude history: the sidebar box asks both at once and shows
// each result with its project, its date and the matching words.
import { dayDate, shortWhen } from '@/lib/dates';

/** The line under a result: "Website · today 10:30 · …the words that matched…". */
export function resultMeta(r: { project?: string | null; at?: string | null; dateOnly?: boolean; snippet?: string | null }, now: Date = new Date()): string {
  const when = r.dateOnly ? dayDate(r.at, now) : shortWhen(r.at, now);
  const snippet = r.snippet?.replace(/\s+/g, ' ').trim();
  return [r.project || null, when, snippet ? `…${snippet}…` : null].filter(Boolean).join(' · ');
}

/** A snippet worth showing: not just the title again (the history index sometimes returns the title as its snippet). */
export function usefulSnippet(title: string, snippet: string | null | undefined): string | null {
  const s = snippet?.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(s) === norm(title) ? null : s;
}
