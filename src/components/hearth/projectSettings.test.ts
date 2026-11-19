import { describe, expect, it } from 'vitest';
import { draftOf, groupDirty, groupUpdate, refill, type ProjectView } from './ProjectSettings';

const view: ProjectView = {
  slug: 'site', name: 'Website', kind: 'personal', client: false, agent: 'claude-code',
  roles: [{ role: 'pm', label: 'Threads and planning', model: null, default: 'claude-opus-5-5' }, { role: 'dev', label: 'Workers (building)', model: 'claude-sonnet-5-5', default: 'claude-sonnet-5-5' }],
  modelChoices: ['claude-opus-5-5', 'claude-sonnet-5-5'], providers: null, availableProviders: [{ name: 'primary', kind: 'anthropic', priority: 10 }, { name: 'backup', kind: 'openai', priority: 20 }],
  planFirst: false, tools: ['docs'], toolChoices: ['docs', 'calendar'], repoMcp: null, instructions: 'Be brief.',
  permissions: { mode: 'default', allow: ['Bash(npm test:*)'], deny: [], defaults: ['Read'], alwaysDenied: ['Bash(sudo:*)'], allowAuto: false },
  budget: null, monthCost: 4.78, remote: null, extraFolders: [], canEdit: true,
};

describe('project settings saved a group at a time', () => {
  it('starts clean: nothing to save', () => {
    const d = draftOf(view);
    for (const g of ['general', 'models', 'permissions', 'tools', 'budget', 'github'] as const) expect(groupDirty(g, d, view)).toBe(false);
  });
  it('sends only the group\'s own fields, built as the single Save built them', () => {
    const d = { ...draftOf(view), name: 'Site', instructions: 'Be brief. British English.', planFirst: true, budget: '50', warnAt: '75' };
    expect(groupUpdate('general', d, view, true)).toEqual({ name: 'Site', instructions: 'Be brief. British English.' });
    expect(groupUpdate('models', d, view, true)).toEqual({ models: { pm: null, dev: 'claude-sonnet-5-5' }, providers: null });
    expect(groupUpdate('permissions', d, view, true)).toEqual({ planFirst: true, permissions: { mode: 'default', allow: ['Bash(npm test:*)'], deny: [] } });
    expect(groupUpdate('budget', d, view, true)).toEqual({ budget: { monthlyUsd: 50, warnAt: 0.75 } });
    // Fields that only went out when changed still only go out when changed.
    expect(groupUpdate('tools', d, view, true)).toEqual({});
    expect(groupUpdate('github', d, view, true)).toEqual({});
    expect(groupUpdate('tools', { ...d, tools: ['docs', 'calendar'] }, view, true)).toEqual({ tools: ['docs', 'calendar'] });
    expect(groupUpdate('github', { ...d, remoteUrl: 'https://github.com/o/r.git', remoteToken: 't' }, view, true)).toEqual({ remote: { url: 'https://github.com/o/r.git', token: 't' } });
    expect(groupUpdate('github', { ...d, remoteUrl: 'https://github.com/o/r.git' }, view, false)).toEqual({});
  });
  it('keeps the old rules: no auto without allowing it, a picked provider order, instructions only when the server keeps them', () => {
    const d = { ...draftOf(view), mode: 'auto', allowAuto: false, allProviders: false, order: ['backup', 'primary'] };
    expect(groupUpdate('permissions', d, view, true)).toEqual({ planFirst: false, permissions: { mode: 'default', allow: ['Bash(npm test:*)'], deny: [] } });
    expect(groupUpdate('models', d, view, true)).toEqual({ models: { pm: null, dev: 'claude-sonnet-5-5' }, providers: ['backup', 'primary'] });
    expect(groupUpdate('general', draftOf({ ...view, instructions: null }), { ...view, instructions: null }, true)).toEqual({ name: 'Website' });
  });
  it('knows which group changed', () => {
    const d = draftOf(view);
    expect(groupDirty('general', { ...d, name: 'Site' }, view)).toBe(true);
    expect(groupDirty('models', { ...d, models: { pm: 'claude-haiku-5-5', dev: 'claude-sonnet-5-5' } }, view)).toBe(true);
    expect(groupDirty('models', { ...d, allProviders: false }, view)).toBe(true);
    expect(groupDirty('permissions', { ...d, allowText: 'Bash(npm test:*)\n\n' }, view)).toBe(false);
    expect(groupDirty('permissions', { ...d, denyText: 'Bash(curl:*)' }, view)).toBe(true);
    expect(groupDirty('budget', { ...d, warnAt: '50' }, view)).toBe(false);
    expect(groupDirty('budget', { ...d, budget: '20' }, view)).toBe(true);
    expect(groupDirty('github', { ...d, remoteToken: 'x' }, view)).toBe(true);
  });
  it('saving one group keeps unsaved edits in the others', () => {
    const d = { ...draftOf(view), name: 'Site', denyText: 'Bash(curl:*)' };
    const after = refill(d, { ...view, name: 'Site' }, 'general');
    expect(after.name).toBe('Site');
    expect(after.denyText).toBe('Bash(curl:*)');
    expect(groupDirty('general', after, { ...view, name: 'Site' })).toBe(false);
    expect(groupDirty('permissions', after, { ...view, name: 'Site' })).toBe(true);
  });
});
