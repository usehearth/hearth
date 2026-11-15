// Admin threads (server extension `admin_threads`): a thread that runs as the owner on the machine with the admin
// runner, with no project walls and a few hard lines the runner enforces. Only this install can type in one: every
// prompt and every admin card answer is signed with the admin key, which the desktop shell keeps in the OS keychain.
// The runner checks the signature against the public key the owner pinned in its admin.json; the server only passes
// signatures through, so the server, other windows and other devices can watch an admin thread but never steer it.
//
// What is signed (the runner checks exactly this, runner/src/admin.ts):
//   "hearth-admin-v1\n<prompt|permission>\n<thread id>\n<digest>\n<time ms>\n<counter>"
//   prompt digest     sha256 hex of JSON.stringify({ text, images: [sha256 hex of each image's base64] })
//   permission digest sha256 hex of JSON.stringify({ requestId, optionId })
// `text` is the prompt as the server forwards it (its text blocks joined, resource links and text files inlined).
import type { AcpContentBlock } from '@/vendor/acp/types';

interface TauriInternals { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }
const tauri = (): TauriInternals | null => (typeof window !== 'undefined' ? ((window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ ?? null) : null);

/** Where the admin key lives on this install: the keychain (desktop), a dev-only browser key, or nowhere (web). */
export function adminKeyHome(): 'keychain' | 'dev-browser' | null {
  if (tauri()) return 'keychain';
  return import.meta.env.DEV ? 'dev-browser' : null;
}

// ---------- dev only: a browser key, so the admin path can be tried in `npm run dev` ----------
// Production web builds drop this (import.meta.env.DEV is false there), so a web page can never hold an admin key.
const DEV_DB = 'hearth-dev-admin';
async function devStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DEV_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function devGet(): Promise<CryptoKeyPair | null> {
  const db = await devStore();
  return new Promise((resolve) => { const t = db.transaction('k').objectStore('k').get('pair'); t.onsuccess = () => resolve((t.result as CryptoKeyPair) ?? null); t.onerror = () => resolve(null); });
}
async function devPut(p: CryptoKeyPair) {
  const db = await devStore();
  await new Promise<void>((resolve, reject) => { const t = db.transaction('k', 'readwrite').objectStore('k').put(p, 'pair'); t.onsuccess = () => resolve(); t.onerror = () => reject(t.error); });
}
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** The admin key's public half (base64 of the raw 32 bytes), or null when this install has none. */
export async function adminPublicKey(): Promise<string | null> {
  const t = tauri();
  if (t) return t.invoke<string | null>('admin_key_public');
  if (!import.meta.env.DEV) return null;
  const p = await devGet().catch(() => null);
  return p ? b64(await crypto.subtle.exportKey('raw', p.publicKey)) : null;
}

/** Make the admin key (once; an existing one is kept). Returns its public half. */
export async function createAdminKey(): Promise<string> {
  const t = tauri();
  if (t) return t.invoke<string>('admin_key_create');
  if (!import.meta.env.DEV) throw new Error('Admin keys live in the desktop app (the OS keychain), not in a web page.');
  const have = await adminPublicKey();
  if (have) return have;
  const p = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  await devPut(p);
  return b64(await crypto.subtle.exportKey('raw', p.publicKey));
}

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The short id the server shows for a key (first 16 hex of sha256 of the raw public key). */
export async function keyFingerprint(pubB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(pubB64), (c) => c.charCodeAt(0));
  const d = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** The prompt's text and images as the server forwards them to the runner (core's toCorePrompt). */
export function forwardedPrompt(blocks: readonly AcpContentBlock[]): { text: string; images: string[] } {
  const parts: string[] = [];
  const images: string[] = [];
  for (const b of blocks as readonly any[]) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text') parts.push(String(b.text ?? ''));
    else if (b.type === 'image' && b.data) images.push(String(b.data));
    else if (b.type === 'resource_link') parts.push(`\n[${b.title || b.name || b.uri}](${b.uri})`);
    else if (b.type === 'resource') {
      const r = b.resource ?? {};
      if (typeof r.text === 'string') parts.push(`\n<context ref="${r.uri ?? ''}">\n${r.text}\n</context>`);
      else throw new Error('Admin threads take text, images and text files. Attach other files in a project thread.');
    }
  }
  return { text: parts.join(''), images };
}

export async function promptDigest(blocks: readonly AcpContentBlock[]): Promise<string> {
  const { text, images } = forwardedPrompt(blocks);
  return sha256hex(JSON.stringify({ text, images: await Promise.all(images.map(sha256hex)) }));
}
export const answerDigest = (requestId: string, optionId: string) => sha256hex(JSON.stringify({ requestId, optionId }));

export interface AdminSig { sig: string; ts: number; counter: number }
let lastCounter = 0;
/** Sign one admin message. The counter only goes up (the runner refuses a used one), so it is the time, bumped. */
export async function signAdmin(kind: 'prompt' | 'permission', threadId: string, digest: string): Promise<AdminSig> {
  const ts = Date.now();
  const counter = Math.max(ts, lastCounter + 1);
  lastCounter = counter;
  const message = `hearth-admin-v1\n${kind}\n${threadId}\n${digest}\n${ts}\n${counter}`;
  const t = tauri();
  if (t) return { sig: await t.invoke<string>('admin_sign', { message }), ts, counter };
  if (!import.meta.env.DEV) throw new Error('This device has no admin key. Type in admin threads from Hearth on the laptop.');
  const p = await devGet();
  if (!p) throw new Error('This device has no admin key. Make one in Settings > Admin.');
  return { sig: b64(await crypto.subtle.sign({ name: 'Ed25519' }, p.privateKey, new TextEncoder().encode(message))), ts, counter };
}

/** The `_meta` for an admin prompt. */
export async function adminPromptMeta(threadId: string, blocks: readonly AcpContentBlock[]) {
  return { hearth: { adminSig: await signAdmin('prompt', threadId, await promptDigest(blocks)) } };
}
/** A signed answer to an admin card (a CLIProxyAPI change). */
export async function adminAnswerSig(threadId: string, requestId: string, optionId: string) {
  return signAdmin('permission', threadId, await answerDigest(requestId, optionId));
}

/** What the owner pastes into the runner's admin.json (in its data folder, usually %USERPROFILE%\.monolith\admin.json). */
export const adminJson = (pub: string) => JSON.stringify({ publicKey: pub }, null, 2);

/** `_hearth/admin`: what the server says about admin threads. */
export interface AdminInfo {
  available: boolean; runnerOnline: boolean; keyFingerprint: string | null; isAdminDevice: boolean;
  chain: { ok: boolean; entries: number; badSeq: number | null; why: string; laptopHead: { seq: number; ok: boolean } | null };
  threads: { sessionId: string; title: string; updatedAt: string; archived: boolean; origin: string | null; calls: number; refusals: number; flags: AdminFlag[] }[];
  flags: (AdminFlag & { title: string })[];
}
export interface AdminFlag { chatId: string; kind: string; text: string; at: string }
export interface AuditEntry { seq: number; at: string; kind: string; tool: string | null; line: string | null; outcome: string | null; detail: string | null; requestId: string | null }
export const LINE_NAMES: Record<string, string> = { secret: 'Secret', reboot: 'Reboot', delete: 'Permanent delete', client: 'Client folder', cliproxy: 'CLIProxyAPI' };
