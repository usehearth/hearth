// claude.ai data export (Settings > Privacy > Export data on claude.ai; the desktop app's Chat tab is the same account)
// -> conversations the import wizard can upload. Each chat becomes a Claude Code-style transcript (one JSON record a
// line), so the server stores, reads and searches it exactly like a Claude Code conversation (source "claude-ai").
// Works in the browser too: the zip is read here, nothing is sent until the user confirms the import.
// Export shape: conversations.json = [{uuid, name, created_at, updated_at, project_uuid?, chat_messages: [{uuid,
// sender: 'human'|'assistant', text, content?: [{type, text|thinking|name|input|content}], created_at, attachments?:
// [{file_name, extracted_content}], files?: [{file_name}]}]}]; projects.json = [{uuid, name}]; users.json = [{uuid}].
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
export interface ChatExport { account: string; label: string; units: LocalUnit[]; bytes: Map<string, Uint8Array>; skipped: number; memories: MemoryFile[] }

/** Two parts of one account's export (claude.ai now sends conversations-000.zip, memories-000.zip, ... separately). */
export function mergeExports(a: ChatExport, b: ChatExport): ChatExport {
  const ids = new Set(b.units.map((u) => u.id));
  const paths = new Set(b.memories.map((m) => m.path));
  return {
    account: a.account, label: [a.label, b.label].filter((v, i, all) => all.indexOf(v) === i).join(' + '),
    units: [...a.units.filter((u) => !ids.has(u.id)), ...b.units], bytes: new Map([...a.bytes, ...b.bytes]),
    skipped: a.skipped + b.skipped, memories: [...a.memories.filter((m) => !paths.has(m.path)), ...b.memories],
  };
}

/** Read an export zip (the old single zip, or one of the new conversations-000 / memories-000 / projects-000 zips), or its conversations.json alone. */
export async function readClaudeExport(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ChatExport> {
  const raw = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array>;
  if (/\.json$/i.test(file.name)) files = { 'conversations.json': raw };
  else {
    try { files = unzipSync(raw, { filter: (f) => /(^|\/)(conversations|projects|users)\.json$/.test(f.name) || /(^|\/)(memories|projects)\/[^/]+\.json$/.test(f.name) }); }
    catch { throw new Error('That file is not a zip. Choose the export zip claude.ai emailed you.'); }
  }
  const pick = (n: string) => { const k = Object.keys(files).find((x) => x === n || x.endsWith('/' + n)); return k ? JSON.parse(strFromU8(files[k])) : null; };
  const each = (dir: string) => Object.keys(files).filter((k) => new RegExp(`(^|/)${dir}/[^/]+\\.json$`).test(k)).map((k) => { try { return JSON.parse(strFromU8(files[k])); } catch { return null; } }).filter(Boolean);
  const memoryDocs = each('memories');
  const memories: MemoryFile[] = memoryDocs.flatMap((d: any) => (Array.isArray(d?.memory_files) ? d.memory_files : []))
    .filter((m: any) => typeof m?.path === 'string' && typeof m?.content === 'string')
    .map((m: any) => ({ path: m.path, content: m.content, updated_at: m.updated_at ?? null }));
  const conversations = pick('conversations.json') ?? (memories.length || each('projects').length ? [] : null);
  if (!Array.isArray(conversations)) throw new Error('No conversations.json in that file. Choose conversations-000.zip (or the export zip) from claude.ai.');
  // Project names: the old projects.json, or the new projects/<uuid>.json files.
  const projects = new Map<string, string>([...(pick('projects.json') ?? []), ...each('projects')].filter((p: any) => p?.uuid).map((p: any) => [p.uuid, String(p.name ?? '').trim()]));
  const users = pick('users.json') ?? [];
  // One folder per account, so two accounts' exports never clash and a newer export replaces only what changed.
  const accountKey = users[0]?.uuid ?? conversations[0]?.account?.uuid ?? memoryDocs[0]?.account_uuid ?? file.name;
  const account = (await sha(String(accountKey))).slice(0, 10);
  const folder = `claude-ai-${account}`;
  const units: LocalUnit[] = [];
  const bytes = new Map<string, Uint8Array>();
  let skipped = 0;
  for (const c of conversations) {
    const msgs: any[] = Array.isArray(c?.chat_messages) ? c.chat_messages : [];
    if (!c?.uuid || !/^[A-Za-z0-9_-]{1,80}$/.test(String(c.uuid)) || !msgs.length) { skipped++; continue; }
    const name = String(c.name ?? '').trim();
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
    const body = enc.encode(lines.join('\n') + '\n');
    const uuid = String(c.uuid), rel = `${folder}/${uuid}.jsonl`;
    const projectName = c.project_uuid ? projects.get(c.project_uuid) ?? '' : String(c.project?.name ?? '').trim();
    const fingerprint = (await sha(`${c.updated_at ?? ''}|${msgs.length}|${body.length}`)).slice(0, 32);
    bytes.set(rel, body);
    units.push({
      id: (await sha(`${folder}/${uuid}`)).slice(0, 24), folder, uuid, source: 'claude-ai', fingerprint, cwd: null, repo: null,
      hint: projectName || null, title: name || firstUser.replace(/\s+/g, ' ').slice(0, 80) || 'Untitled chat',
      started: c.created_at ?? null, ended: c.updated_at ?? c.created_at ?? null, messages, threads: 0, bytes: body.length,
      files: [{ rel, size: body.length }], from: `claude.ai export ${file.name}`,
    });
  }
  return { account, label: `claude.ai export (${file.name})`, units, bytes, skipped, memories };
}
