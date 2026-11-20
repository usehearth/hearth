// The sidebar's Recent view: every thread across projects, newest first, in the time groups Claude's app uses
// (Pinned, Today, Yesterday, Previous 7 days, Older). The Projects view keeps them by project.
import type { ThreadItem } from '@/lib/directory';

export interface RecentGroup { label: string; items: ThreadItem[] }

const DAY = 86_400_000;
const at = (t: Pick<ThreadItem, 'updatedAt'>) => Date.parse(t.updatedAt ?? '') || 0;

export function recentGroups(groups: readonly { main?: ThreadItem; threads: ThreadItem[] }[], now: Date = new Date()): RecentGroup[] {
  const all = groups.flatMap((g) => [...(g.main ? [g.main] : []), ...g.threads]).filter((t) => !t.archived)
    .sort((a, b) => at(b) - at(a));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: { label: string; from: number }[] = [
    { label: 'Today', from: today }, { label: 'Yesterday', from: today - DAY }, { label: 'Previous 7 days', from: today - 7 * DAY }, { label: 'Older', from: -Infinity },
  ];
  const out: RecentGroup[] = [];
  const pinned = all.filter((t) => t.pinned);
  if (pinned.length) out.push({ label: 'Pinned', items: pinned });
  for (const b of buckets) {
    const next = buckets[buckets.indexOf(b) - 1];
    const items = all.filter((t) => !t.pinned && at(t) >= b.from && (!next || at(t) < next.from));
    if (items.length) out.push({ label: b.label, items });
  }
  return out;
}

/** Which sidebar view this device last used ("projects" unless it picked "recent"). */
export function sidebarView(): 'projects' | 'recent' {
  try { return localStorage.getItem('hearth.sidebar.view') === 'recent' ? 'recent' : 'projects'; } catch { return 'projects'; }
}
export function setSidebarView(v: 'projects' | 'recent') {
  try { localStorage.setItem('hearth.sidebar.view', v); } catch { /* private mode: this window only */ }
}
