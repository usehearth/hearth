// claude.ai export reader: taken exactly as the person has it (a zip, several zips, the folder they unzipped it into,
// zips inside that folder), parts found by name, accounts kept apart, what Hearth can't keep named for the receipt.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { readClaudeExport, readExports, type ExportFile } from './claudeai';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const conv = (uuid: string, name: string, account = 'acct-1', extra: Record<string, unknown> = {}) => ({ uuid, name, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T11:00:00Z', account: { uuid: account },
  chat_messages: [{ uuid: `${uuid}-m1`, sender: 'human', text: 'hello', content: [{ type: 'text', text: 'hello' }], created_at: '2026-10-01T10:00:00Z' },
    { uuid: `${uuid}-m2`, sender: 'assistant', text: 'hi', content: [{ type: 'text', text: 'hi' }], created_at: '2026-10-01T10:00:05Z' }], ...extra });
const json = (v: unknown) => strToU8(JSON.stringify(v));
const zip = (files: Record<string, unknown>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v instanceof Uint8Array ? v : json(v)])));
const ef = (path: string, data: Uint8Array): ExportFile => ({ path, size: data.length, bytes: async () => data });
const file = (name: string, files: Record<string, unknown>) => { const z = zip(files); return { name, arrayBuffer: async () => z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer }; };

/** The folder claude.ai's export unzips into today: one zip per part. */
const splitFolder = (folder: string, account: string, email: string, chats: unknown[]) => [
  ef(`${folder}/conversations-000.zip`, zip({ 'conversations.json': chats })),
  ef(`${folder}/memories-000.zip`, zip({ [`memories/${account}.json`]: { account_uuid: account, memory_files: [{ path: '/profile.md', content: '# Profile', updated_at: '2026-11-01T00:00:00Z' }, { path: '/areas/new-pc.md', content: 'PC' }] } })),
  ef(`${folder}/projects-000.zip`, zip({ 'projects/p-1.json': { uuid: 'p-1', name: 'Garden plans', prompt_template: 'Be brief.', docs: [{ uuid: 'd-1', filename: 'beds.txt', content: 'x' }], creator: { uuid: account } } })),
  ef(`${folder}/light_metadata-000.zip`, zip({ 'users.json': [{ uuid: account, full_name: 'Sam', email_address: email }], 'login_history.json': { login_events: [] } })),
  ef(`${folder}/frames-000.zip`, zip({ 'artifacts/a-1/artifact.json': { title: 'Budget tracker' }, 'artifacts/a-1/page.md': '# Budget', 'artifacts/a-1/versions/1-ab.html': '<p>x</p>' })),
  ef(`${folder}/feedback-000.zip`, zip({ 'reflections/r-1.json': {} })),
];

describe('claude.ai export', () => {
  it('reads the folder of zips claude.ai unzips into, finding every part without being told', async () => {
    const { exports, problems } = await readExports(splitFolder('claude-export-personal', 'acct-1', 'sam@example.com', [conv('c1', 'One', 'acct-1', { project_uuid: 'p-1' }), conv('c2', 'Two'), { ...conv('c3', 'Nothing'), chat_messages: [] }]));
    expect(problems).toEqual([]);
    expect(exports).toHaveLength(1);
    const x = exports[0];
    expect(x.label).toBe('claude.ai, sam@example.com');
    expect(x.inputs).toEqual(['claude-export-personal']);
    expect(x.units.map((u) => u.title).sort()).toEqual(['One', 'Two']);
    expect(x.units.find((u) => u.title === 'One')?.hint).toBe('Garden plans');
    expect(x.memories.map((m) => m.path)).toEqual(['/profile.md', '/areas/new-pc.md']);
    // Everything else is named, with its reason: the empty chat, the Project's file and instructions, the artifact, feedback.
    const nk = x.notKept.map((n) => `${n.reason}: ${n.title}`).sort();
    expect(nk).toEqual([
      'empty: Nothing',
      'unsupported: Feedback you gave on claude.ai',
      'unsupported: Instructions of the claude.ai Project Garden plans',
      'unsupported: The artifact "Budget tracker" made on claude.ai',
      'unsupported: beds.txt (a file in the claude.ai Project Garden plans)',
    ]);
    expect(x.skipped).toBe(1);
    expect(x.ignored).toEqual(['sign-in history']);
  });

  it('keeps the ids of earlier imports: same folder per account, same conversation id', async () => {
    const { exports } = await readExports([ef('conversations-000.zip', zip({ 'conversations.json': [conv('c1', 'One')] }))]);
    const folder = `claude-ai-${sha('acct-1').slice(0, 10)}`;
    expect(exports[0].units[0].folder).toBe(folder);
    expect(exports[0].units[0].id).toBe(sha(`${folder}/c1`).slice(0, 24));
  });

  it('reads an export that was fully unzipped (plain files in folders), from a folder picker', async () => {
    const files = [
      ef('export/conversations.json', json([conv('c1', 'One')])),
      ef('export/users.json', json([{ uuid: 'acct-1', email_address: 'sam@example.com' }])),
      ef('export/memories/acct-1.json', json({ account_uuid: 'acct-1', memory_files: [{ path: '/profile.md', content: 'hi' }] })),
      ef('export/artifacts/a-9/page.md', strToU8('# page')),
    ];
    const { exports } = await readExports(files);
    expect(exports).toHaveLength(1);
    expect(exports[0].units).toHaveLength(1);
    expect(exports[0].memories).toHaveLength(1);
    expect(exports[0].notKept.map((n) => n.id)).toEqual(['artifact:a-9']);
  });

  it('takes several zips at once and puts the parts of one account together', async () => {
    const { exports } = await readExports([
      ef('conversations-000.zip', zip({ 'conversations.json': [conv('c1', 'One'), conv('c2', 'Two')] })),
      ef('memories-000.zip', zip({ 'memories/acct.json': { account_uuid: 'acct-1', memory_files: [{ path: '/profile.md', content: '# Profile' }] } })),
      ef('light_metadata-000.zip', zip({ 'users.json': [{ uuid: 'acct-1', email_address: 'sam@example.com' }] })),
    ]);
    expect(exports).toHaveLength(1);
    expect(exports[0].label).toBe('claude.ai, sam@example.com');
    expect(exports[0].units).toHaveLength(2);
    expect(exports[0].memories).toHaveLength(1);
  });

  it('two accounts stay apart; the same export given twice (zip and unzipped folder) counts each chat once', async () => {
    const personal = splitFolder('claude-export-personal', 'acct-1', 'sam@example.com', [conv('c1', 'One'), conv('c2', 'Two')]);
    const work = splitFolder('claude-export-work', 'acct-2', 'sam@work.example', [conv('w1', 'Quarterly plan', 'acct-2')]);
    const again = ef('data-2026-11-18.zip', zip({ 'conversations.json': [conv('c1', 'One'), { ...conv('c2', 'Two, newer'), updated_at: '2026-10-02T00:00:00Z' }], 'users.json': [{ uuid: 'acct-1' }] }));
    const { exports } = await readExports([...personal, ...work, again]);
    expect(exports.map((x) => x.label).sort()).toEqual(['claude.ai, sam@example.com', 'claude.ai, sam@work.example']);
    const p = exports.find((x) => x.email === 'sam@example.com')!;
    expect(p.units.map((u) => u.title).sort()).toEqual(['One', 'Two, newer']);
    expect(p.inputs.sort()).toEqual(['claude-export-personal', 'data-2026-11-18.zip']);
    expect(exports.find((x) => x.email === 'sam@work.example')!.units.map((u) => u.title)).toEqual(['Quarterly plan']);
  });

  it("the parts picked as loose zips, with another account's zip beside them, still come together", async () => {
    const parts = splitFolder('claude-export-personal', 'acct-1', 'sam@example.com', [conv('c1', 'One')]).map((f) => ({ ...f, path: f.path.split('/').pop()! }));
    const other = ef('data-agency.zip', zip({ 'conversations.json': [conv('w1', 'Kickoff', 'acct-2')], 'users.json': [{ uuid: 'acct-2', email_address: 'sam@agency.example' }] }));
    const { exports } = await readExports([...parts, other]);
    expect(exports.map((x) => x.label).sort()).toEqual(['claude.ai, sam@agency.example', 'claude.ai, sam@example.com']);
    const p = exports.find((x) => x.email === 'sam@example.com')!;
    expect(p.notKept.filter((n) => n.id.startsWith('artifact:'))).toHaveLength(1);
    expect(p.inputs).toContain('frames-000.zip');
  });

  it('nothing is passed over without a line: an unknown file, a zip four deep, a broken zip, files attached to a chat', async () => {
    const withFiles = { ...conv('c9', 'With a photo'), chat_messages: [{ uuid: 'p1', sender: 'human', text: 'Look', created_at: '2026-10-01T10:00:00Z', files: [{ file_name: 'photo.jpg' }], content: [{ type: 'text', text: 'Look' }, { type: 'image' }] }] };
    const deep = zip({ 'a.zip': zip({ 'b.zip': zip({ 'c.zip': zip({ 'd.zip': zip({ 'e.zip': zip({ 'conversations.json': [conv('c8', 'Deep')] }) }) }) }) }) });
    const { exports } = await readExports([
      ef('export/conversations.json', json([conv('c1', 'One'), withFiles])), ef('export/notes.txt', strToU8('hi')), ef('export/.DS_Store', strToU8('x')),
      ef('export/broken.zip', strToU8('not a zip')), ef('export/deep.zip', deep),
    ]);
    const nk = exports[0].notKept.map((n) => `${n.reason}:${n.title}`).sort();
    expect(nk).toEqual(['unreadable:export/broken.zip', 'unsupported:1 file attached to the chat "With a photo"'.replace('1 file', '2 files'),
      'unsupported:export/deep.zip/a.zip/b.zip/c.zip/d.zip/e.zip', 'unsupported:export/notes.txt'].sort());
    expect(exports[0].ignored).toContain('.DS_Store');
  });

  it('a zip inside a zip is opened too', async () => {
    const outer = zip({ 'claude-export/conversations-000.zip': zip({ 'conversations.json': [conv('c1', 'One')] }) });
    const { exports } = await readExports([ef('download.zip', outer)]);
    expect(exports[0].units.map((u) => u.title)).toEqual(['One']);
  });

  it('a chat with an id Hearth cannot use is named, not dropped silently', async () => {
    const { exports } = await readExports([ef('c.zip', zip({ 'conversations.json': [conv('bad id!', 'Odd one'), conv('c1', 'One')] }))]);
    expect(exports[0].notKept.map((n) => [n.reason, n.title])).toEqual([['unsupported', 'Odd one']]);
  });

  it('says to add the whole export when there are no chats or memories in it', async () => {
    await expect(readExports([ef('frames-000.zip', zip({ 'artifacts/a/page.md': '# x' }))])).rejects.toThrow(/whole export/);
    await expect(readExports([ef('notes.txt', strToU8('hello'))])).rejects.toThrow(/whole export/);
  });

  it('still reads a single file handed over the old way', async () => {
    const x = await readClaudeExport(file('data.zip', { 'conversations.json': [conv('c1', 'One')], 'projects.json': [], 'users.json': [{ uuid: 'acct-1' }] }));
    expect(x.units.map((u) => u.title)).toEqual(['One']);
  });
});
