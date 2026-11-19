// "Bring everything from Claude": the engine (no UI; docs/import.md). One run covers Claude Code conversations,
// claude.ai chats and memories, and skills, subagents, slash commands, output styles and plugins:
// 1. find: every Claude Code home on this machine (desktop app: src-tauri/src/import.rs) and the claude.ai exports
//    the person added (src/lib/claudeai.ts), into one inventory of everything found, per source;
// 2. ask the server for a plan (`_hearth/import/preview`): a project per repo or folder, client tags guessed;
// 3. bring it across (`begin`, then each conversation in chunks with `file` + `commit`, then `extensions`, then
//    `memories`), and `finish`, which answers with the receipt the server counted from what it stored.
// Re-runnable: the server says what it already has, so a second run moves only what is new or changed. Nothing is
// ever removed from Claude or from this computer.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ChatExport } from './claudeai';
import type { ItemKind, Reason, Receipt } from './receipt';
import { clientMatcher, holdBack, secretLines } from './secrets.ts';

/** The desktop app (Tauri) can read this machine's folders; a browser can't. (Same test as servers.ts; kept here so
 * the engine also loads outside the app, e.g. in the server's import proof.) */
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

/** One conversation found on this machine or in an export. */
export interface LocalUnit {
  id: string; folder: string; uuid: string; source: 'claude-code' | 'claude-ai'; fingerprint: string;
  cwd: string | null; repo: string | null; hint?: string | null; title: string; started: string | null; ended: string | null;
  messages: number; threads: number; bytes: number; files: { rel: string; size: number; sha256?: string }[]; from: string;
  /** Desktop scan only: the folder it was found in (shown locally, never sent). */
  root?: string;
  /** Desktop scan only: the desktop app profile whose session it was (null: the terminal). */
  profile?: string | null;
  /** Desktop scan only: an empty transcript, or one that couldn't be read. */
  empty?: boolean; unreadable?: string | null;
  /** Desktop scan only: the other sources the same conversation was found in. */
  also?: string[];
}
/** A Claude Code home (or the older archive) on this machine, with what it holds and whose it is. */
export interface LocalSource {
  path: string; label: string; kind: 'claude-code' | 'archive'; conversations: number; account?: string | null;
  home?: string; homePath?: string; email?: string | null; org?: string | null;
  profiles?: { name: string; sessions: number }[]; terminal?: number; lastUsed?: number | null; folders?: number;
  skills?: number; agents?: number; commands?: number; outputStyles?: number; plugins?: number;
}
/** A skill, subagent, slash command, output style or plugin hook set read from a home or a project folder. */
export interface ConfigItem {
  key: string; source: string; origin: string; repo: string | null; kind: 'skill' | 'agent' | 'command' | 'output_style' | 'hook' | 'plugin';
  name: string; description: string | null; bytes: number; content: string | null; files: Record<string, string> | null; leftOut: string[]; problem: string | null;
  /** Found where Claude Code doesn't load it (a skill one folder down, a loose file in skills/): where. */
  nested?: string | null;
}
export interface Odd { from: string; rel: string; reason: string }

export interface Proposal {
  key: string; name: string; slug: string; path: string; client: string | null; existing: string | null; existingName?: string | null; mergeInto?: string;
  conversations: number; bytes: number; new: number; changed: number; unchanged: number; refile: number; last: string | null;
}
export interface Preview {
  token: string; proposals: Proposal[]; pools: string[]; defaultPool: string; clientPool: string | null; clientTerms?: string[];
  projects: { slug: string; name: string; client: string | null }[];
  totals: { conversations: number; bytes: number; new: number; changed: number; unchanged: number; refile: number };
}
export type Choice = { action: 'new'; name: string; slug: string; client: string | null } | { action: 'existing'; slug: string } | { action: 'merge'; into: string } | { action: 'skip' };
export interface Begun { runId: number; created: string[]; upload: { id: string; folder: string; uuid: string; files: { rel: string; size: number }[] }[]; refiled: number; unchanged: number; skipped: number; chunkBytes: number }

/** Reads bytes of one file of a conversation. */
export type Reader = (u: LocalUnit, rel: string, offset: number, length: number) => Promise<Uint8Array>;

export const canScanThisMachine = isDesktop;

export async function localSources(): Promise<LocalSource[]> {
  if (!isDesktop) return [];
  return invoke<LocalSource[]>('import_sources');
}

/** Scan the chosen folders. `onProgress(done, total)` while it reads. */
export async function scanLocal(paths: string[], onProgress?: (done: number, total: number) => void): Promise<{ home: string; units: LocalUnit[]; odd?: Odd[] }> {
  const off = onProgress ? await listen<[number, number]>('import-scan', (e) => onProgress(e.payload[0], e.payload[1])) : null;
  try { return await invoke<{ home: string; units: LocalUnit[]; odd?: Odd[] }>('import_scan', { paths }); }
  finally { off?.(); }
}

/** Skills and the like in these homes (their homePath) and project folders (repos from the latest scan). */
export async function readConfig(homes: string[], repos: string[]): Promise<ConfigItem[]> {
  if (!isDesktop || (!homes.length && !repos.length)) return [];
  return (await invoke<{ items: ConfigItem[] }>('import_config', { homes, repos })).items;
}

export const localReader: Reader = async (u, rel, offset, length) => new Uint8Array(await invoke<ArrayBuffer>('import_read', { id: u.id, rel, offset, length }));
export const memoryReader = (bytes: Map<string, Uint8Array>): Reader => async (_u, rel, offset, length) => (bytes.get(rel) ?? new Uint8Array()).subarray(offset, offset + length);

/** The same conversation found twice (an archive copy and the original): keep the bigger one. */
export function mergeUnits(lists: { units: LocalUnit[]; reader: Reader }[]): Map<string, { unit: LocalUnit; reader: Reader }> {
  const out = new Map<string, { unit: LocalUnit; reader: Reader }>();
  for (const l of lists) for (const u of l.units) { const had = out.get(u.id); if (!had || had.unit.bytes < u.bytes) out.set(u.id, { unit: u, reader: l.reader }); }
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- the inventory: everything found, per source, in the person's terms ----------

export interface SourceIn { id: string; kind: 'claude-code' | 'claude-ai' | 'repos' | 'archive'; label: string; detail?: string | null }
export interface FoundItem { source: string; kind: ItemKind; id: string; title: string; profile?: string | null; reason?: Reason | null; detail?: string | null; dupOf?: string | null }
export interface Inventory { sources: SourceIn[]; items: FoundItem[] }

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** A home in the person's terms: whose it is, which desktop profiles use it, never just a path. */
export function homeWords(s: LocalSource): { title: string; who: string | null; profiles: string | null; holds: string } {
  const profiles = (s.profiles ?? []).filter((p) => p.sessions > 0);
  const names = profiles.map((p) => (p.name === 'Main' ? 'the main Claude app' : p.name));
  const title = s.kind === 'archive' ? 'Your older Hearth archive'
    : s.account ? `Claude Code: ${s.account}` : names.length ? `Claude Code: ${list(names)}` : 'Claude Code on this computer';
  const who = s.email ? `Signed in as ${s.email}${s.org && !s.org.includes(s.email) ? ` (${s.org})` : ''}` : null;
  const term = s.terminal ? `${count(s.terminal, 'session')} from the terminal` : '';
  const fromProfiles = profiles.map((p, i) => `${count(p.sessions, 'session')} from ${names[i] === 'the main Claude app' ? names[i] : `the ${names[i]} profile`}`);
  // A ~/.claude-something home is its own setup: a desktop profile's session in it is a copy, not where that profile lives.
  const prof = s.account ? ([term, ...fromProfiles].filter(Boolean).length ? `${list([term, ...fromProfiles].filter(Boolean))}.`.replace(/^./, (c) => c.toUpperCase()) : null)
    : profiles.length > 1 ? `${list(names)} all keep their Code sessions here: ${profiles.length === 2 ? 'both are' : 'all are'} included${term ? `, with ${term}` : ''}.`
    : profiles.length === 1 ? `The ${names[0]} profile keeps its Code sessions here${term ? `, with ${term}` : ''}.` : term ? `${term[0].toUpperCase()}${term.slice(1)}.` : null;
  const parts = [s.conversations ? `${count(s.conversations, 'conversation')}${s.folders ? ` from ${count(s.folders, 'folder')}` : ''}` : '',
    s.skills ? count(s.skills, 'skill') : '', s.agents ? count(s.agents, 'subagent') : '', s.commands ? count(s.commands, 'slash command') : '',
    s.outputStyles ? count(s.outputStyles, 'output style') : '', s.plugins ? count(s.plugins, 'plugin') : ''].filter(Boolean);
  return { title, who, profiles: prof, holds: parts.join(' · ') || 'Nothing to bring' };
}

const KIND_OF: Record<ConfigItem['kind'], ItemKind> = { skill: 'skill', agent: 'agent', command: 'command', output_style: 'output_style', hook: 'hook', plugin: 'other' };
/** A config item's title on the receipt: its name and where it came from. */
export const configTitle = (c: ConfigItem) => (c.kind === 'plugin' ? `The plugin ${c.name}` : `${c.name}${c.origin.startsWith('plugin:') ? ` (from the plugin ${c.origin.slice(7)})` : c.origin === 'repo' && c.repo ? ` (in ${c.repo.split('/').pop()})` : ''}`);
const configSha = (c: ConfigItem) => JSON.stringify([c.kind, c.name, c.content, Object.entries(c.files ?? {}).sort(([a], [b]) => a.localeCompare(b))]);

/** What the person left out on the review page (all in by default), and what they chose to bring anyway. */
export interface LeftOut {
  sources?: Set<string>; configGroups?: Set<string>;
  /** Single skills and the like left out (their keys). */
  items?: Set<string>;
  /** Held back (secret, client) or not loadable where they are, brought anyway (their keys). */
  bring?: Set<string>;
  /** When each was decided, if in an earlier import: target -> ISO date (for "you left this out on 18 Nov"). */
  since?: Record<string, string>;
}
/** The group a config item is reviewed in: a home's own, a plugin, or a project folder. */
export const configGroup = (c: ConfigItem) => (c.origin === 'repo' ? `repo:${c.repo}` : `${c.source}|${c.origin}`);

export interface Gathered {
  inventory: Inventory;
  /** Conversations to send (empty and unreadable ones stay out: they are on the inventory with their reason). */
  units: Map<string, { unit: LocalUnit; reader: Reader }>;
  /** Skills and the like that may leave this computer (no secret, no client name, readable, not left out), and the
   * held-back ones the owner chose to bring anyway (`overrule`). */
  config: (ConfigItem & { overrule?: boolean })[];
  /** Held back on this computer: why, and the matching lines (shown here only; never sent). */
  held: Map<string, { reason: 'secret' | 'client'; detail: string; lines: string[] }>;
  memories: { account: string; files: { path: string; content: string; updated_at?: string | null }[] }[];
}

/**
 * Put everything found into one inventory, per source, with the reason for anything that can't go. Holds back
 * (never sends) skills and the like that look like they hold a secret or name a client.
 */
export function gather(o: {
  sources: LocalSource[]; scan: { units: LocalUnit[]; odd?: Odd[] } | null; config: ConfigItem[]; exports: ChatExport[];
  clientTerms?: string[]; leftOut?: LeftOut;
  /** How this machine's conversations are read (the desktop app's; a test hands its own). */
  reader?: Reader;
}): Gathered {
  const skipped = o.leftOut?.sources ?? new Set<string>();
  const groupsOut = o.leftOut?.configGroups ?? new Set<string>();
  const itemsOut = o.leftOut?.items ?? new Set<string>();
  const bring = o.leftOut?.bring ?? new Set<string>();
  const since = (target: string) => { const d = o.leftOut?.since?.[target]; return d ? ` on ${new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, and it stays out until you change it` : ''; };
  const sources: SourceIn[] = [];
  const items: FoundItem[] = [];
  const units = new Map<string, { unit: LocalUnit; reader: Reader }>();
  const labelOf = new Map<string, string>();
  for (const s of o.sources) {
    const w = homeWords(s);
    const label = w.who ? `${w.title} (${s.email})` : w.title;
    labelOf.set(s.path, label);
    sources.push({ id: s.path, kind: s.kind, label, detail: [w.profiles, s.home ? `Kept in ${s.home} on this computer.` : ''].filter(Boolean).join(' ') || null });
  }
  const leave = (src: string) => (skipped.has(src) ? { reason: 'skipped' as const, detail: `you left out ${labelOf.get(src) ?? 'this source'}${since(`import:source:${src}`)}` } : null);
  for (const u of o.scan?.units ?? []) {
    const out = leave(u.from);
    const reason = out ?? (u.unreadable ? { reason: 'unreadable' as const, detail: u.unreadable } : u.empty ? { reason: 'empty' as const, detail: 'the transcript file is empty' } : null);
    items.push({ source: u.from, kind: 'conversation', id: u.id, title: u.title, profile: u.profile ?? 'terminal', ...(reason ?? {}) });
    for (const a of u.also ?? []) {
      // The same conversation in another home: counted there too, as the same as this copy.
      const r2 = leave(a) ?? (reason ? reason : null);
      items.push({ source: a, kind: 'conversation', id: u.id, title: u.title, ...(r2 ? r2 : { dupOf: u.from }) });
    }
    if (!reason) units.set(u.id, { unit: u, reader: o.reader ?? localReader });
  }
  for (const x of o.scan?.odd ?? []) items.push({ source: x.from, kind: 'conversation', id: `odd:${x.rel}`, title: x.rel.split('/').pop() ?? x.rel, reason: 'unsupported', detail: x.reason });

  // Skills and the like: held back here if they look like they hold a secret or name a client.
  const client = clientMatcher(o.clientTerms ?? []);
  const config: Gathered['config'] = [];
  const held: Gathered['held'] = new Map();
  const firstOf = new Map<string, ConfigItem>();
  if (o.config.some((c) => c.source === 'repos')) sources.push({ id: 'repos', kind: 'repos', label: 'Your project folders', detail: 'Skills, subagents and slash commands kept inside project folders that your conversations used.' });
  for (const c of o.config) {
    const kind = KIND_OF[c.kind];
    const base = { source: c.source, kind, id: c.key, title: configTitle(c) };
    const out = leave(c.source) ?? (groupsOut.has(configGroup(c)) ? { reason: 'skipped' as const, detail: `you chose to leave these out${since(`import:group:${configGroup(c)}`)}` } : null)
      ?? (itemsOut.has(c.key) ? { reason: 'skipped' as const, detail: `you chose to leave it out${since(`import:ext:${c.key}`)}` } : null);
    if (out) { items.push({ ...base, ...out }); continue; }
    if (c.problem || c.content == null) { items.push({ ...base, reason: 'unreadable', detail: c.problem ?? 'it could not be read' }); continue; }
    if (c.nested && !bring.has(c.key)) {
      items.push({ ...base, reason: 'not_loadable', detail: /^skills\/synced\//.test(c.nested) ? `in ${c.nested}: one of the Claude app's own skills, synced here` : `in ${c.nested}, where Claude Code doesn't load it` });
      continue;
    }
    const h = holdBack(c.name, c.content, c.files, client);
    if (h && !bring.has(c.key)) {
      // The matching lines stay on this computer: the receipt (on the server) says only which kind and which line.
      const lines = h.reason === 'secret' ? [c.content, ...Object.values(c.files ?? {})].flatMap((t) => secretLines(t)).slice(0, 3) : [];
      held.set(c.key, { ...h, lines });
      items.push({ ...base, reason: h.reason, detail: `${h.detail}${lines.length ? ` (${lines.map((l) => l.split(':')[0]).join(', ')})` : ''}` });
      continue;
    }
    // The very same item in two homes: sent once, the second is "the same as" the first.
    const same = firstOf.get(configSha(c));
    if (same && same.origin !== 'repo' && c.origin !== 'repo') { items.push({ ...base, id: same.key, dupOf: same.source }); continue; }
    firstOf.set(configSha(c), c);
    items.push(base);
    config.push(h ? { ...c, overrule: true } : c);
  }

  const memories: Gathered['memories'] = [];
  for (const x of o.exports) {
    const id = `claude-ai:${x.account}`;
    const extra = [x.inputs.length ? `Added from ${list(x.inputs)}.` : '', x.ignored.length ? `Not needed in Hearth: ${list(x.ignored)}.` : ''].filter(Boolean).join(' ');
    sources.push({ id, kind: 'claude-ai', label: x.label, detail: extra || null });
    labelOf.set(id, x.label);
    for (const u of x.units) {
      const out = leave(id);
      items.push({ source: id, kind: 'chat', id: u.id, title: u.title, ...(out ?? {}) });
      if (!out) units.set(u.id, { unit: u, reader: memoryReader(x.bytes) });
    }
    for (const n of x.notKept) items.push({ source: id, kind: n.kind, id: n.id, title: n.title, reason: n.reason, detail: n.detail });
    const mem = x.memories.map((m) => ({ path: m.path, content: m.content, updated_at: m.updated_at ?? null }));
    for (const m of mem) items.push({ source: id, kind: 'memory', id: `${x.account}:${m.path}`, title: `Memory: ${m.path.replace(/^\//, '').replace(/\.md$/, '')}`, ...(leave(id) ?? {}) });
    if (mem.length && !skipped.has(id)) memories.push({ account: x.account, files: mem });
  }
  return { inventory: { sources, items }, units, config, held, memories };
}

// ---------- remembered choices ----------

/** What earlier imports left out or brought anyway (`_hearth/import/info` decisions): target -> decision and date. */
export type Decisions = Record<string, { decision: 'leave-out' | 'bring'; at: string }>;

/** This run's starting point from earlier choices: the same things stay out (or come) until the person changes them. */
export function leftOutFrom(d: Decisions | null | undefined): Required<Pick<LeftOut, 'sources' | 'configGroups' | 'items' | 'bring' | 'since'>> {
  const pick = (kind: string, decision: string) => new Set(Object.entries(d ?? {}).filter(([t, v]) => t.startsWith(`import:${kind}:`) && v.decision === decision).map(([t]) => t.slice(`import:${kind}:`.length)));
  return { sources: pick('source', 'leave-out'), configGroups: pick('group', 'leave-out'), items: pick('ext', 'leave-out'), bring: pick('ext', 'bring'),
    since: Object.fromEntries(Object.entries(d ?? {}).map(([t, v]) => [t, v.at])) };
}

/** Folders left out last time stay out: applied over the server's suggestions. */
export function applyPlaceDecisions(choices: Record<string, Choice>, d: Decisions | null | undefined): Record<string, Choice> {
  const out = { ...choices };
  for (const k of Object.keys(out)) if (d?.[`import:place:${k}`]?.decision === 'leave-out') out[k] = { action: 'skip' };
  return out;
}

/** What to remember from this run (sent with `begin`): left out and brought-anyway, and forgetting what is back in. */
export function rememberOf(o: { decisions?: Decisions | null; leftOut: LeftOut; sourceIds: string[]; choices: Record<string, Choice>; configKeys: string[]; groups: string[] }): Record<string, 'leave-out' | 'bring' | null> {
  const out: Record<string, 'leave-out' | 'bring' | null> = {};
  const set = (target: string, now: 'leave-out' | 'bring' | null) => { const had = o.decisions?.[target]?.decision ?? null; if (now !== had) out[target] = now; };
  for (const id of o.sourceIds) set(`import:source:${id}`, o.leftOut.sources?.has(id) ? 'leave-out' : null);
  for (const [k, c] of Object.entries(o.choices)) set(`import:place:${k}`, c.action === 'skip' ? 'leave-out' : null);
  for (const g of o.groups) set(`import:group:${g}`, o.leftOut.configGroups?.has(g) ? 'leave-out' : null);
  for (const k of o.configKeys) set(`import:ext:${k}`, o.leftOut.items?.has(k) ? 'leave-out' : o.leftOut.bring?.has(k) ? 'bring' : null);
  return out;
}

// ---------- a home at a glance ----------

const SKIP_PARTS = /^(\.worktrees|worktrees|\.claude)$/i;
/** Where a conversation was, as a folder path with worktrees folded into their repo. */
const placePath = (u: LocalUnit) => (u.repo || u.cwd || '').replace(/\\/g, '/').replace(/\/\.claude\/worktrees\/.*$/i, '').replace(/\/\.?worktrees\/[^/]+(\/.*)?$/i, '').replace(/\/+$/, '');

/**
 * A home's conversations at a glance, to decide about old or test-looking ones: the date range, the folder most of them
 * are in, and the commonest project names. ("143 conversations, 7 to 10 Oct 2026, mostly in pm-hq: acme-api, playground".)
 */
export function homeStats(units: LocalUnit[]): { count: number; from: string | null; to: string | null; mostlyIn: { name: string; path: string; n: number } | null; top: { name: string; n: number }[] } {
  const dates = units.flatMap((u) => [u.started, u.ended]).filter((d): d is string => !!d).sort();
  const names = new Map<string, number>();
  const ancestors = new Map<string, number>();
  for (const u of units) {
    const p = placePath(u);
    if (!p) continue;
    const parts = p.split('/').filter((x) => x && !SKIP_PARTS.test(x));
    const name = parts[parts.length - 1] ?? p;
    names.set(name, (names.get(name) ?? 0) + 1);
    // Every folder above it, from three levels down (C:/Projects/Other, not C:/ or C:/Projects).
    for (let i = 3; i < parts.length; i++) { const a = parts.slice(0, i).join('/'); ancestors.set(a, (ancestors.get(a) ?? 0) + 1); }
  }
  // The deepest folder that holds at least three quarters of them (when there are enough to say "mostly").
  let mostlyIn: { name: string; path: string; n: number } | null = null;
  if (units.length >= 4) for (const [a, n] of ancestors) {
    if (n < units.length * 0.75) continue;
    if (!mostlyIn || a.length > mostlyIn.path.length) mostlyIn = { name: a.split('/').pop() ?? a, path: a, n };
  }
  const top = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, n]) => ({ name, n }));
  return { count: units.length, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, mostlyIn, top };
}

/** "7 to 10 Oct 2026", "3 Oct to 19 Nov 2026", "12 Feb 2025 to 19 Nov 2026". */
export function dateRange(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const a = new Date(from), b = new Date(to);
  const day = (d: Date) => d.getUTCDate(), mon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), yr = (d: Date) => d.getUTCFullYear();
  if (yr(a) !== yr(b)) return `${day(a)} ${mon(a)} ${yr(a)} to ${day(b)} ${mon(b)} ${yr(b)}`;
  if (mon(a) !== mon(b)) return `${day(a)} ${mon(a)} to ${day(b)} ${mon(b)} ${yr(b)}`;
  return day(a) === day(b) ? `${day(a)} ${mon(a)} ${yr(a)}` : `${day(a)} to ${day(b)} ${mon(b)} ${yr(b)}`;
}

/** What the plan request sends: metadata only (no file content), and the inventory for the receipt. */
export const previewOf = (request: Request, units: LocalUnit[], home: string, inventory?: Inventory) =>
  request<Preview>('_hearth/import/preview', { home, units: units.map(({ from: _f, root: _r, profile: _p, empty: _e, unreadable: _u, also: _a, ...u }) => u), ...(inventory ? { inventory } : {}) });

/** Default choices from a preview: existing projects as they are, suggested merges applied, everything else new. */
export function defaultChoices(p: Preview): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const x of p.proposals) {
    out[x.key] = x.existing ? { action: 'existing', slug: x.existing } : x.mergeInto ? { action: 'merge', into: x.mergeInto } : { action: 'new', name: x.name, slug: x.slug, client: x.client };
  }
  return out;
}

export interface Progress { done: number; total: number; bytesDone: number; bytesTotal: number; current: string; failed: { id: string; title: string; error: string }[] }

/**
 * Upload every conversation the server asked for, one at a time: each file in chunks (resuming where the server says
 * it has got to), then commit. A conversation that fails is reported and skipped; the next run tries it again.
 * `finish: false` leaves the run open for the rest of the import (skills, memories); `upload` then returns no report.
 */
export async function upload(request: Request, begun: Begun, units: Map<string, { unit: LocalUnit; reader: Reader }>, onProgress: (p: Progress) => void, stop?: () => boolean, finish = true) {
  const chunk = Math.min(begun.chunkBytes || 4 << 20, 4 << 20);
  const p: Progress = { done: 0, total: begun.upload.length, bytesDone: 0, bytesTotal: begun.upload.reduce((n, u) => n + u.files.reduce((m, f) => m + f.size, 0), 0), current: '', failed: [] };
  onProgress({ ...p });
  for (const item of begun.upload) {
    if (stop?.()) break;
    const local = units.get(item.id);
    if (!local) { p.failed.push({ id: item.id, title: item.id, error: 'not found on this computer any more' }); continue; }
    p.current = local.unit.title;
    onProgress({ ...p, failed: [...p.failed] });
    try {
      for (const f of item.files) {
        let offset = 0, guard = 0;
        for (;;) {
          const want = Math.min(chunk, Math.max(0, f.size - offset));
          const data = want ? await local.reader(local.unit, f.rel, offset, want) : new Uint8Array();
          const last = offset + data.length >= f.size || data.length < want;
          const r = await request<{ next: number }>('_hearth/import/file', { runId: begun.runId, id: item.id, rel: f.rel, offset, data: toBase64(data), last });
          p.bytesDone += data.length;
          if (r.next !== offset + data.length) { // the server lost its place (e.g. it restarted): go back to where it is
            if (++guard > 5) throw new Error('the server kept losing its place in this file');
            p.bytesDone -= offset + data.length - r.next; offset = r.next; continue;
          }
          offset = r.next;
          if (last) break;
        }
      }
      await request('_hearth/import/commit', { runId: begun.runId, id: item.id });
    } catch (e: any) {
      p.failed.push({ id: item.id, title: local.unit.title, error: String(e?.message ?? e).slice(0, 200) });
    }
    p.done++;
    onProgress({ ...p, failed: [...p.failed] });
  }
  if (!finish) return { runId: begun.runId, report: null as any };
  return request<{ runId: number; report: any }>('_hearth/import/finish', { runId: begun.runId, failed: p.failed.map((f) => ({ id: f.id, error: f.error })), stopped: !!stop?.() });
}

export type Phase = 'conversations' | 'extensions' | 'memories' | 'counting';
export interface RunProgress { phase: Phase; conversations: Progress | null; extensions: { done: number; total: number }; memories: { done: number; total: number } }

/**
 * The whole import after the plan: make the projects, send the conversations, the skills and the like, the
 * memories, then finish. Returns the receipt the server counted. `scopes` overrides where a config group goes
 * ('global' or a project slug), from the review page.
 */
export async function bringAcross(o: {
  request: Request; preview: Preview; choices: Record<string, Choice>; pool?: string; gathered: Gathered; scopes?: Record<string, string>;
  onProgress: (p: RunProgress) => void; stop?: () => boolean;
  /** Choices to remember for the next run (rememberOf). */
  remember?: Record<string, 'leave-out' | 'bring' | null>;
  /** The server counts receipts (`_hearth/import/info` says `receipts: true`). An older one takes the conversations and
   * memories as before, no skills, and answers with no receipt. */
  receipts?: boolean;
}): Promise<{ begun: Begun; receipt: Receipt | null; report: any }> {
  const receipts = o.receipts !== false;
  const { request, gathered: g } = o;
  const begun = await request<Begun>('_hearth/import/begin', { token: o.preview.token, choices: o.choices, ...(o.pool ? { pool: o.pool } : {}), ...(o.remember && receipts ? { remember: o.remember } : {}) });
  const rp: RunProgress = { phase: 'conversations', conversations: null, extensions: { done: 0, total: receipts ? g.config.length : 0 }, memories: { done: 0, total: g.memories.reduce((n, m) => n + m.files.length, 0) } };
  const tell = () => o.onProgress({ ...rp, extensions: { ...rp.extensions }, memories: { ...rp.memories } });
  let failed: Progress['failed'] = [];
  await upload(request, begun, g.units, (p) => { rp.conversations = p; failed = p.failed; tell(); }, o.stop, false);
  if (!o.stop?.() && receipts) {
    rp.phase = 'extensions'; tell();
    // In batches that stay well under the connection's message size.
    let batch: Gathered["config"] = [], size = 0;
    const send = async () => {
      if (!batch.length) return;
      await request('_hearth/import/extensions', { runId: begun.runId, items: batch.map((c) => ({ key: c.key, kind: c.kind, name: c.name, description: c.description, content: c.content, files: c.files, repo: c.repo, origin: c.origin, ...(c.overrule ? { overrule: true } : {}), ...(c.nested ? { nested: c.nested } : {}),
        ...(o.scopes?.[configGroup(c)] ? { scope: o.scopes[configGroup(c)] } : {}) })) });
      rp.extensions.done += batch.length; tell();
      batch = []; size = 0;
    };
    for (const c of g.config) {
      const b = (c.content?.length ?? 0) + Object.values(c.files ?? {}).reduce((n, t) => n + t.length, 0);
      if (batch.length && (size + b > 6_000_000 || batch.length >= 200)) await send();
      batch.push(c); size += b;
    }
    await send();
  }
  if (!o.stop?.()) {
    rp.phase = 'memories'; tell();
    for (const m of g.memories) for (let i = 0; i < m.files.length; i += 500) {
      const part = m.files.slice(i, i + 500);
      await request('_hearth/import/memories', { ...(receipts ? { runId: begun.runId } : {}), account: m.account, files: part });
      rp.memories.done += part.length; tell();
    }
  }
  rp.phase = 'counting'; tell();
  const fin = await request<{ runId: number; report: any; receipt?: Receipt }>('_hearth/import/finish', { runId: begun.runId, failed: failed.map((f) => ({ id: f.id, error: f.error })), stopped: !!o.stop?.() });
  return { begun, receipt: fin.receipt ?? null, report: fin.report };
}
