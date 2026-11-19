// claude.ai data export (Settings > Privacy > Export data on claude.ai; the desktop app's Chat tab is the same account)
// -> conversations the import can upload. Each chat becomes a Claude Code-style transcript (one JSON record a line), so
// the server stores, reads and searches it exactly like a Claude Code conversation (source "claude-ai").
//
// The export is taken exactly as the person has it: the zip claude.ai emailed, several zips, or the folder they
// unzipped it into (which today holds more zips: conversations-000.zip, memories-000.zip, projects-000.zip,
// light_metadata-000.zip, frames-000.zip, ...). Zips inside folders and zips are opened here; the parts are found by
// name, wherever they sit. Nobody is asked to pick files out of an export. What Hearth can't keep (artifacts, claude.ai
// Project files, feedback, cloud routines) is listed, so the receipt can name it.
// Works in the browser too: nothing is sent until the person starts the import.
// Shapes: conversations.json = [{uuid, name, created_at, updated_at, account: {uuid}, project_uuid?, chat_messages: [{uuid,
// sender: 'human'|'assistant', text, content?: [{type, text|thinking|name|input|content}], created_at, attachments?:
// [{file_name, extracted_content}], files?: [{file_name}]}]}]; users.json = [{uuid, full_name, email_address}];
// projects.json = [{uuid, name}] or projects/<uuid>.json = {uuid, name, prompt_template, docs: [{uuid, filename}]};
// memories/<uuid>.json = {account_uuid, memory_files: [{path, content, updated_at}]}.
import { unzipSync, strFromU8 } from 'fflate';
import type { LocalUnit } from './importer';

const enc = new TextEncoder();

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function blocks(m: any): any[] {
  const out: any[] = [];
  for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'text', text: b.text });
    else if (b?.type === 'thinking' && typeof b.thinking === 'string') out.push({ type: 'thinking', thinking: b.thinking });
    else if (b?.type === 'tool_use') out.push({ type: 'tool_use', id: b.id ?? '', name: b.name ?? 'tool', input: b.input ?? {} });
    else if (b?.type === 'tool_result') out.push({ type: 'tool_result', tool_use_id: b.tool_use_id ?? '', content: Array.isArray(b.content) ? b.content.filter((c: any) => c?.type === 'text') : String(b.content ?? '') });
  }
  if (!out.some((b) => b.type === 'text') && typeof m.text === 'string' && m.text.trim()) out.unshift({ type: 'text', text: m.text });
  for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
    const name = String(a?.file_name ?? 'attachment');
    out.push({ type: 'text', text: a?.extracted_content ? `[Attached: ${name}]\n${a.extracted_content}` : `[Attached: ${name}]` });
  }
  for (const f of Array.isArray(m.files) ? m.files : []) if (f?.file_name) out.push({ type: 'text', text: `[File: ${f.file_name}]` });
  return out;
}

/** A claude.ai memory file (memories-000.zip): what claude.ai has learned about the owner, as markdown. */
export interface MemoryFile { path: string; content: string; updated_at?: string | null }
/** Something found in an export that won't become a conversation, and why (for the receipt). */
export interface ExportNotKept { id: string; kind: 'chat' | 'other'; title: string; reason: 'empty' | 'unsupported' | 'unreadable'; detail: string }
export interface ChatExport {
  /** 10 hex characters from the account's id: one folder per account, so two accounts never clash. */
  account: string;
  /** In the person's terms: "claude.ai, sam@example.com". */
  label: string; email: string | null; name: string | null;
  /** What the person gave (zip names, folder names) that held this account's parts. */
  inputs: string[];
  units: LocalUnit[]; bytes: Map<string, Uint8Array>;
  /** Chats with no messages (also in notKept, with the reason). */
  skipped: number;
  memories: MemoryFile[];
  notKept: ExportNotKept[];
  /** Files in the export that hold nothing of the person's to keep (sign-in history), by name. */
  ignored: string[];
}

/** One file of what the person gave: inside a zip, in a folder (picker or drop), or a loose file. */
export interface ExportFile { path: string; size: number; bytes(): Promise<Uint8Array> }
/** A File from an <input> (a folder picker gives each file its path inside the folder) as an ExportFile. */
export const exportFile = (f: File, path?: string): ExportFile =>
  ({ path: (path ?? ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)).replace(/\\/g, '/').replace(/^\/+/, ''), size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) });

// The parts Hearth reads, wherever they sit in the export.
const PART = /(^|\/)(conversations|projects|users)\.json$|(^|\/)(memories|projects)\/[^/]+\.json$|(^|\/)artifacts\/[^/]+\/artifact\.json$/;
const base = (p: string) => p.split('/').pop() ?? p;

interface Entry { path: string; group: string; data: Uint8Array }
interface Name { path: string; group: string }

/**
 * Open everything the person gave: zips (and zips inside folders or zips, two levels down), folders, loose files.
 * Returns the parts Hearth reads, with the bytes, and the names of everything else. `group` is the top thing the
 * person gave (the folder they picked, or the zip), so the parts of one export stay together.
 */
export async function openExport(files: ExportFile[]): Promise<{ entries: Entry[]; names: Name[]; problems: string[] }> {
  const entries: Entry[] = [], names: Name[] = [], problems: string[] = [];
  const top = (f: ExportFile) => (f.path.includes('/') ? f.path.split('/')[0] : f.path);
  const visit = async (path: string, group: string, data: () => Promise<Uint8Array>, depth: number) => {
    if (/\.zip$/i.test(path)) {
      let raw: Uint8Array;
      try { raw = await data(); } catch (e) { problems.push(`${path}: could not be read (${(e as Error)?.message ?? e})`); return; }
      let inner: Record<string, Uint8Array>;
      // Only the parts Hearth reads (and zips inside) are unpacked; everything else is listed by name.
      try { inner = unzipSync(raw, { filter: (f) => { if (f.name.endsWith('/')) return false; const want = PART.test(f.name) || (/\.zip$/i.test(f.name) && depth < 2); if (!want) names.push({ path: `${path}/${f.name}`, group }); return want; } }); }
      catch { problems.push(`${path}: not a zip Hearth can open`); return; }
      for (const [n, b] of Object.entries(inner)) await visit(`${path}/${n}`, group, async () => b, depth + 1);
      return;
    }
    if (PART.test(path) || /\.json$/i.test(path) && !path.includes('/')) {
      try { entries.push({ path, group, data: await data() }); } catch (e) { problems.push(`${path}: could not be read (${(e as Error)?.message ?? e})`); }
    } else names.push({ path, group });
  };
  for (const f of files) await visit(f.path, top(f), () => f.bytes(), 0);
  return { entries, names, problems };
}

const parse = (e: Entry): any => { try { return JSON.parse(strFromU8(e.data)); } catch { return undefined; } };

/** What the other parts of an export are, in words (for the receipt's "not kept yet" lines and the inventory). */
function otherKind(path: string): { id: string; title: string } | null {
  const p = path.replace(/^.*?(?=(artifacts|reflections|claude_code_cloud)\/)/, '');
  let m = /^artifacts\/([^/]+)\//.exec(p);
  if (m) return { id: `artifact:${m[1]}`, title: 'An artifact (page) made on claude.ai' };
  m = /^reflections\/([^/]+)\.json$/.exec(p);
  if (m) return { id: `feedback:${m[1]}`, title: 'Feedback you gave on claude.ai' };
  if (/^claude_code_cloud\/[^/]+\.json$/.test(p)) return { id: `cloud:${base(p)}`, title: `Claude Code on the web: ${base(p).replace(/\.json$/, '').replace(/_/g, ' ')}` };
  return null;
}

/**
 * Read one or more claude.ai exports from whatever the person gave. Parts of one account (in one zip, in separate
 * zips, or in a folder) come together as one ChatExport; two accounts stay apart. Throws only when nothing in what
 * was given looks like a claude.ai export.
 */
export async function readExports(files: ExportFile[]): Promise<{ exports: ChatExport[]; problems: string[] }> {
  const { entries, names, problems } = await openExport(files);
  const by = (rx: RegExp) => entries.filter((e) => rx.test(e.path));
  const usersFiles = by(/(^|\/)users\.json$/), convFiles = by(/(^|\/)conversations\.json$/).concat(entries.filter((e) => !e.path.includes('/') && /\.json$/i.test(e.path) && !/(conversations|users|projects)\.json$/.test(e.path)));
  const memFiles = by(/(^|\/)memories\/[^/]+\.json$/), projFiles = by(/(^|\/)projects\.json$|(^|\/)projects\/[^/]+\.json$/), artFiles = by(/(^|\/)artifacts\/[^/]+\/artifact\.json$/);
  // Which account each group (the folder or zip the person gave) belongs to: users.json, else the chats' account, else the memories'.
  const groupAccount = new Map<string, string>();
  const users = new Map<string, { email: string | null; name: string | null }>();
  for (const e of usersFiles) for (const u of (Array.isArray(parse(e)) ? parse(e) : [])) {
    if (!u?.uuid) continue;
    const had = users.get(String(u.uuid));
    users.set(String(u.uuid), { email: u.email_address ?? had?.email ?? null, name: u.full_name ?? had?.name ?? null });
    if (!groupAccount.has(e.group)) groupAccount.set(e.group, String(u.uuid));
  }
  const convs: { e: Entry; list: any[] }[] = [];
  for (const e of convFiles) {
    const j = parse(e);
    if (!Array.isArray(j)) { if (/conversations\.json$/.test(e.path)) problems.push(`${e.path}: not a list of chats Hearth can read`); continue; }
    convs.push({ e, list: j });
    const acc = j.find((c: any) => c?.account?.uuid)?.account?.uuid;
    if (acc && !groupAccount.has(e.group)) groupAccount.set(e.group, String(acc));
  }
  const memDocs = memFiles.map((e) => ({ e, j: parse(e) })).filter((x) => x.j && Array.isArray(x.j.memory_files));
  for (const { e, j } of memDocs) if (j.account_uuid && !groupAccount.has(e.group)) groupAccount.set(e.group, String(j.account_uuid));
  // Old single-file pick (a conversations.json alone, or a zip without account ids): the file's name stands in.
  const known = [...new Set(groupAccount.values())];
  const accountOf = (e: Entry, own?: string | null) => own || groupAccount.get(e.group) || (known.length === 1 ? known[0] : e.group);
  if (!convs.length && !memDocs.length) {
    throw new Error(files.length ? 'No claude.ai chats or memories in what you added. Add the whole export: the zip claude.ai emailed you, or the folder you unzipped it into.' : 'Nothing added yet.');
  }

  interface Acc { key: string; inputs: Set<string>; chats: Map<string, any>; memories: Map<string, MemoryFile>; notKept: ExportNotKept[]; ignored: string[]; projects: Set<string> }
  const accs = new Map<string, Acc>();
  const acc = (key: string, group: string) => { const a = accs.get(key) ?? accs.set(key, { key, inputs: new Set(), chats: new Map(), memories: new Map(), notKept: [], ignored: [], projects: new Set() }).get(key)!; a.inputs.add(group); return a; };
  // The same chat in two copies of the export (the zip and its unzipped folder): the newer copy.
  for (const { e, list } of convs) {
    const own = list.find((c: any) => c?.account?.uuid)?.account?.uuid;
    const a = acc(accountOf(e, own), e.group);
    for (const c of list) {
      const id = String(c?.uuid ?? '');
      const had = a.chats.get(id);
      if (!had || String(c?.updated_at ?? '') > String(had?.updated_at ?? '')) a.chats.set(id || `#${a.chats.size}`, c);
      if (c?.project_uuid) a.projects.add(String(c.project_uuid));
    }
  }
  for (const { e, j } of memDocs) {
    const a = acc(accountOf(e, j.account_uuid), e.group);
    for (const m of j.memory_files) {
      if (typeof m?.path !== 'string' || typeof m?.content !== 'string') continue;
      const had = a.memories.get(m.path);
      if (!had || String(m.updated_at ?? '') > String(had.updated_at ?? '')) a.memories.set(m.path, { path: m.path, content: m.content, updated_at: m.updated_at ?? null });
    }
  }
  // claude.ai Projects: names for filing chats; their files and instructions Hearth can't keep yet (named on the receipt).
  const projects = new Map<string, { name: string; docs: { uuid: string; filename: string }[]; prompt: string; group: string; creator: string | null }>();
  for (const e of projFiles) {
    const j = parse(e);
    for (const p of Array.isArray(j) ? j : j ? [j] : []) {
      if (!p?.uuid) continue;
      projects.set(String(p.uuid), { name: String(p.name ?? '').trim(), docs: Array.isArray(p.docs) ? p.docs.map((d: any) => ({ uuid: String(d?.uuid ?? ''), filename: String(d?.filename ?? 'a file') })) : [],
        prompt: typeof p.prompt_template === 'string' ? p.prompt_template.trim() : '', group: e.group, creator: p.creator?.uuid ? String(p.creator.uuid) : null });
    }
  }
  const projectAccount = (uuid: string, p: { group: string; creator: string | null }) =>
    [...accs.values()].find((a) => a.projects.has(uuid))?.key ?? (p.creator && accs.has(p.creator) ? p.creator : accountOf({ path: '', group: p.group, data: new Uint8Array() }));
  for (const [uuid, p] of projects) {
    const a = acc(projectAccount(uuid, p), p.group);
    const label = p.name || 'a claude.ai Project';
    if (p.prompt) a.notKept.push({ id: `project-instructions:${uuid}`, kind: 'other', title: `Instructions of the claude.ai Project ${label}`, reason: 'unsupported', detail: 'Hearth does not bring claude.ai Project instructions yet' });
    for (const d of p.docs) a.notKept.push({ id: `project-file:${d.uuid || `${uuid}/${d.filename}`}`, kind: 'other', title: `${d.filename} (a file in the claude.ai Project ${label})`, reason: 'unsupported', detail: 'Hearth does not bring claude.ai Project files yet' });
  }
  // Artifacts, feedback, cloud routines: one line each on the receipt. Sign-in history is not the person's content.
  const seen = new Set<string>();
  const artTitle = new Map(artFiles.map((e) => { const j = parse(e); return [/artifacts\/([^/]+)\//.exec(e.path)?.[1] ?? '', String(j?.title ?? j?.name ?? '').trim()]; }));
  for (const n of [...names, ...artFiles.map((e) => ({ path: e.path, group: e.group }))]) {
    const a = acc(accountOf({ path: '', group: n.group, data: new Uint8Array() }), n.group);
    if (/(^|\/)login_history\.json$/.test(n.path)) { a.ignored.push('sign-in history'); continue; }
    const o = otherKind(n.path);
    if (!o) { if (!/\.zip$/i.test(n.path)) a.ignored.push(n.path); continue; }
    if (seen.has(`${a.key}/${o.id}`)) continue;
    seen.add(`${a.key}/${o.id}`);
    const t = o.id.startsWith('artifact:') ? artTitle.get(o.id.slice(9)) : '';
    a.notKept.push({ id: o.id, kind: 'other', title: t ? `The artifact "${t}" made on claude.ai` : o.title, reason: 'unsupported', detail: 'Hearth does not bring this part of a claude.ai export yet' });
  }

  const out: ChatExport[] = [];
  for (const a of accs.values()) {
    if (!a.chats.size && !a.memories.size && !a.notKept.length) continue;
    const account = (await sha(String(a.key))).slice(0, 10);
    const folder = `claude-ai-${account}`;
    const u = users.get(a.key);
    const units: LocalUnit[] = [];
    const bytes = new Map<string, Uint8Array>();
    const notKept = [...a.notKept];
    let skipped = 0;
    for (const c of a.chats.values()) {
      const msgs: any[] = Array.isArray(c?.chat_messages) ? c.chat_messages : [];
      const name = String(c?.name ?? '').trim();
      const title = name || String(msgs.find((m) => m?.sender === 'human')?.text ?? '').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled chat';
      const nid = String(c?.uuid ?? '');
      if (!nid || !/^[A-Za-z0-9_-]{1,80}$/.test(nid)) { notKept.push({ id: `bad:${nid || title}`, kind: 'chat', title, reason: 'unsupported', detail: 'it has no id Hearth can use' }); continue; }
      if (!msgs.length) { skipped++; notKept.push({ id: (await sha(`${folder}/${nid}`)).slice(0, 24), kind: 'chat', title, reason: 'empty', detail: 'it has no messages' }); continue; }
      const lines: string[] = [];
      if (name) lines.push(JSON.stringify({ type: 'custom-title', customTitle: name, source: 'claude-ai' }));
      let messages = 0, firstUser = '';
      for (const m of msgs) {
        const type = m?.sender === 'human' ? 'user' : 'assistant';
        const content = blocks(m);
        if (!content.length) continue;
        messages++;
        if (type === 'user' && !firstUser) firstUser = content.find((b) => b.type === 'text')?.text ?? '';
        lines.push(JSON.stringify({ type, uuid: m.uuid, timestamp: m.created_at ?? c.created_at, source: 'claude-ai', message: { role: type, content } }));
      }
      // A chat whose messages are blank in the export still keeps its title (as earlier imports did).
      const body = enc.encode(lines.join('\n') + '\n');
      const rel = `${folder}/${nid}.jsonl`;
      const projectName = c.project_uuid ? projects.get(c.project_uuid)?.name ?? '' : String(c.project?.name ?? '').trim();
      // Same fingerprint as earlier versions of this reader, so a re-run finds what is already here.
      const fingerprint = (await sha(`${c.updated_at ?? ''}|${msgs.length}|${body.length}`)).slice(0, 32);
      bytes.set(rel, body);
      units.push({
        id: (await sha(`${folder}/${nid}`)).slice(0, 24), folder, uuid: nid, source: 'claude-ai', fingerprint, cwd: null, repo: null,
        hint: projectName || null, title: name || firstUser.replace(/\s+/g, ' ').slice(0, 80) || 'Untitled chat',
        started: c.created_at ?? null, ended: c.updated_at ?? c.created_at ?? null, messages, threads: 0, bytes: body.length,
        files: [{ rel, size: body.length }], from: `claude.ai export ${[...a.inputs].join(', ')}`,
      });
    }
    const inputs = [...a.inputs];
    out.push({ account, label: u?.email ? `claude.ai, ${u.email}` : u?.name ? `claude.ai, ${u.name}` : `claude.ai export (${inputs.join(', ')})`, email: u?.email ?? null, name: u?.name ?? null,
      inputs, units, bytes, skipped, memories: [...a.memories.values()], notKept, ignored: [...new Set(a.ignored)] });
  }
  return { exports: out, problems };
}

/** Read one file the old way (a zip or a conversations.json): kept for callers that hand over a single File. */
export async function readClaudeExport(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ChatExport> {
  const { exports } = await readExports([{ path: file.name, size: 0, bytes: async () => new Uint8Array(await file.arrayBuffer()) }]);
  if (!exports.length) throw new Error('No conversations.json in that file. Add the export zip claude.ai emailed you, or the folder you unzipped it into.');
  return exports[0];
}
