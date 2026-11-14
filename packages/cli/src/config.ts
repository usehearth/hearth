// Where the CLI keeps the server address and device key.
// Windows: %APPDATA%\hearth\config.json. Elsewhere: ~/.config/hearth/config.json (mode 0600).
// HEARTH_URL / HEARTH_KEY override the file.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config { url?: string; key?: string }

export function configPath(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'hearth', 'config.json');
  }
  return join(homedir(), '.config', 'hearth', 'config.json');
}

export function readConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    const c = JSON.parse(readFileSync(p, 'utf8'));
    return { url: typeof c.url === 'string' ? c.url : undefined, key: typeof c.key === 'string' ? c.key : undefined };
  } catch {
    throw new Error(`Can't read ${p}; run \`hearth login\` again.`);
  }
}

export function writeConfig(c: Config): string {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(p, 0o600); // an existing file keeps its old mode otherwise
  return p;
}

/** The server to use: env first, then the config file. */
export function resolveServer(): { url: string; key: string } {
  const file = readConfig();
  const url = process.env.HEARTH_URL || file.url;
  const key = process.env.HEARTH_KEY || file.key;
  if (!url || !key) throw new Error('Not logged in: run `hearth login --url <ws url>` or set HEARTH_URL and HEARTH_KEY.');
  return { url: normaliseUrl(url), key: key.trim() };
}

/** Accepts http(s)://host[:port] or ws(s)://... and returns the ACP WebSocket address (same rules as the app). */
export function normaliseUrl(input: string): string {
  let u = input.trim();
  if (!/^[a-z]+:\/\//i.test(u)) u = `ws://${u}`;
  const url = new URL(u);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/acp';
  return url.toString().replace(/\/$/, '');
}
