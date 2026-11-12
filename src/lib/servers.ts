// Servers Hearth connects to. Only the address and a name are remembered on this device; never chat content.
// The key: in the desktop app it lives in the OS keychain; in the web build it is held in memory for this tab only.
import { useSyncExternalStore } from 'react';

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
  keys.set(server.id, s.key.trim());
  servers = [...servers, server];
  save();
  return server;
}

export function removeServer(id: string) {
  keys.delete(id);
  servers = servers.filter((s) => s.id !== id);
  save();
}

export const keyFor = (id: string) => keys.get(id);
export function setKey(id: string, key: string) { keys.set(id, key.trim()); for (const l of listeners) l(); }

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
