import { describe, expect, it } from 'vitest';
import { recentGroups } from './recent';
import type { ThreadItem } from './directory';

const now = new Date(2026, 10, 20, 15, 0);
const t = (id: string, updatedAt: Date | null, extra: Partial<ThreadItem> = {}): ThreadItem => ({
  sessionId: id, title: id, cwd: '', updatedAt: updatedAt?.toISOString() ?? null, project: 'site', projectName: 'Website', kind: 'work',
  status: null, runnerOnline: null, pinned: false, openCards: 0, ...extra,
});

describe('the Recent view', () => {
  it('puts every thread, main threads too, into Pinned, Today, Yesterday, Previous 7 days and Older, newest first', () => {
    const groups = [
      { main: t('main-site', new Date(2026, 10, 20, 9, 0), { kind: 'main' }), threads: [t('a', new Date(2026, 10, 20, 14, 0)), t('b', new Date(2026, 10, 19, 23, 0)), t('pin', new Date(2026, 9, 1), { pinned: true })] },
      { threads: [t('c', new Date(2026, 10, 15, 12, 0), { project: 'home', projectName: 'Home' }), t('d', new Date(2026, 8, 1)), t('never', null)] },
    ];
    expect(recentGroups(groups, now).map((g) => [g.label, g.items.map((x) => x.sessionId)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['a', 'main-site']],
      ['Yesterday', ['b']],
      ['Previous 7 days', ['c']],
      ['Older', ['d', 'never']],
    ]);
  });
  it('leaves out archived threads and empty groups', () => {
    const groups = [{ threads: [t('old', new Date(2026, 8, 1)), t('gone', new Date(2026, 10, 20, 10, 0), { archived: true })] }];
    expect(recentGroups(groups, now)).toEqual([{ label: 'Older', items: [groups[0].threads[0]] }]);
    expect(recentGroups([], now)).toEqual([]);
  });
});
