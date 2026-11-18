// claude.ai export reader: the old single zip and the new split export (conversations-000.zip, memories-000.zip, ...).
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { mergeExports, readClaudeExport } from './claudeai';

const ACCOUNT = { uuid: 'acct-1' };
const conv = (uuid: string, name: string) => ({ uuid, name, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T11:00:00Z', account: ACCOUNT,
  chat_messages: [{ uuid: `${uuid}-m1`, sender: 'human', text: 'hello', content: [{ type: 'text', text: 'hello' }], created_at: '2026-10-01T10:00:00Z' },
    { uuid: `${uuid}-m2`, sender: 'assistant', text: 'hi', content: [{ type: 'text', text: 'hi' }], created_at: '2026-10-01T10:00:05Z' }] });
const file = (name: string, files: Record<string, unknown>) => {
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(JSON.stringify(v))])));
  return { name, arrayBuffer: async () => z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer };
};

describe('claude.ai export', () => {
  it('reads the old single zip', async () => {
    const x = await readClaudeExport(file('data.zip', { 'conversations.json': [conv('c1', 'One')], 'projects.json': [], 'users.json': [{ uuid: 'acct-1' }] }));
    expect(x.units.map((u) => u.title)).toEqual(['One']);
    expect(x.memories).toEqual([]);
  });

  it('reads the new split parts and adds them up per account', async () => {
    const convs = await readClaudeExport(file('conversations-000.zip', { 'conversations.json': [conv('c1', 'One'), conv('c2', 'Two')] }));
    const mems = await readClaudeExport(file('memories-000.zip', { 'memories/acct.json': { account_uuid: 'acct-1', memory_files: [
      { path: '/profile.md', content: '# Profile', updated_at: '2026-11-01T00:00:00Z' }, { path: '/areas/new-pc.md', content: 'PC' }] } }));
    expect(convs.account).toBe(mems.account); // same account, so they merge
    const all = mergeExports(convs, mems);
    expect(all.units).toHaveLength(2);
    expect(all.memories.map((m) => m.path)).toEqual(['/profile.md', '/areas/new-pc.md']);
    // A newer memories part replaces the old one's files, it doesn't double them.
    const again = mergeExports(all, mems);
    expect(again.memories).toHaveLength(2);
  });

  it('takes project names from the new projects/<uuid>.json files', async () => {
    const c = { ...conv('c3', 'In a project'), project_uuid: 'p-1' };
    const x = await readClaudeExport(file('both.zip', { 'conversations.json': [c], 'projects/p-1.json': { uuid: 'p-1', name: 'Garden plans' } }));
    expect(x.units[0].hint).toBe('Garden plans');
  });

  it('says what to pick when a zip has neither conversations nor memories', async () => {
    await expect(readClaudeExport(file('frames-000.zip', { 'frames/x.json': {} }))).rejects.toThrow(/conversations-000\.zip/);
  });
});
