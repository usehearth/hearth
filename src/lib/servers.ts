// Servers Hearth connects to. Only the address and a name are remembered on this device; never chat content.
// The key: in the desktop app it lives in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service);
// in the web build it is held in memory for this tab only.
import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { hostDeleteKey, hostGetKey, hostSetKey, inVsCode } from './hostBridge';

/** True inside the desktop app (Tauri), where keys live in the OS keychain. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface Server {
  id: string;
  name: string;
  /** ws:// or wss:// address of the server's ACP endpoint, e.g. wss://ai.example/acp */
  url: string;
}

const KEY = 'hearth.servers.v1';
const keys = new Map<string, string>();
let servers: Server[] = load();
const listeners = new Set<() => void>();
const notify = () => { servers = [...servers]; for (const l of listeners) l(); };

/** Desktop: read each server's key from the keychain once at start. */
export const keysReady: Promise<void> = isDesktop
  ? Promise.all(servers.map(async (s) => {
      try { const k = await invoke<string | null>('key_get', { serverId: s.id }); if (k) keys.set(s.id, k); } catch { /* ask for it */ }
    })).then(notify)
  : inVsCode
    // VS Code: keys are in the editor's secret storage (packages/vscode).
    ? Promise.all(servers.map(async (s) => { const k = await hostGetKey(s.id); if (k) keys.set(s.id, k); })).then(notify)
    : Promise.resolve();
const storeKey = (id: string, key: string) => {
  keys.set(id, key);
  if (isDesktop) void invoke('key_set', { serverId: id, key }).catch(() => {});
  if (inVsCode) hostSetKey(id, key);
};

function load(): Server[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.url === 'string') : [];
  } catch {
    return [];
  }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(servers)); } catch { /* private mode: this session only */ }
  for (const l of listeners) l();
}

export function useServers(): Server[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => servers);
}

export function addServer(s: { name: string; url: string; key: string }): Server {
  const server: Server = { id: crypto.randomUUID(), name: s.name.trim() || hostOf(s.url), url: normaliseUrl(s.url) };
  storeKey(server.id, s.key.trim());
  servers = [...servers, server];
  save();
  return server;
}

export function removeServer(id: string) {
  keys.delete(id);
  if (isDesktop) void invoke('key_delete', { serverId: id }).catch(() => {});
  if (inVsCode) hostDeleteKey(id);
  servers = servers.filter((s) => s.id !== id);
  save();
}

export const keyFor = (id: string) => keys.get(id);
export function renameServer(id: string, name: string) {
  servers = servers.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s));
  save();
}
/** Forget this device's key for a server (the keychain entry too); the server asks for it again. */
export function forgetKey(id: string) {
  keys.delete(id);
  if (isDesktop) void invoke('key_delete', { serverId: id }).catch(() => {});
  if (inVsCode) hostDeleteKey(id);
  notify();
}
export function setKey(id: string, key: string) { storeKey(id, key.trim()); notify(); }

/** Accepts http(s)://host[:port] or ws(s)://... and returns the ACP WebSocket address. */
export function normaliseUrl(input: string): string {
  let u = input.trim();
  if (!/^[a-z]+:\/\//i.test(u)) u = `ws://${u}`;
  const url = new URL(u);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/acp';
  return url.toString().replace(/\/$/, '');
}

export function hostOf(input: string): string {
  try { return new URL(normaliseUrl(input)).hostname; } catch { return 'Server'; }
}

/** Browsers can't set headers on a WebSocket, so the key travels as a `bearer.<key>` subprotocol (with `acp` offered too). */
export function openSocket(url: string, key: string): WebSocket {
  return new WebSocket(url, ['acp', `bearer.${key}`]);
}
