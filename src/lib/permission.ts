// How a permission card reads: what the agent wants to run, in words, with its own reason, and a warning when the
// command destroys something. The server's card text is kept, minus the old internal wording ("A running pm agent in
// site is waiting for your OK to run this.") and the markdown backticks around commands.

export interface PermissionView {
  /** The card's title without markdown backticks ("Allow: git push origin main"). */
  title: string;
  /** The exact command or call, shown in a code box (no backticks). */
  command: string | null;
  /** Why the agent wants it, in its own words (Claude Code's Bash `description`), when it gave one. */
  reason: string | null;
  /** The server's own line under the title, unless it is the old internal wording. */
  why: string | null;
  /** Set when the command deletes or rewrites something: a short phrase for the warning ("Deletes files"). */
  risk: string | null;
}

const OLD_WHY = /^A running \S+ agent in \S+ is waiting for your OK to run this\.?$/;
const unquote = (s: string) => s.replace(/`/g, '').trim();

// Order matters: the first match names the risk.
const RISKS: [RegExp, string][] = [
  [/\bgit\s+push\b[^\n]*\s(--force(-with-lease)?|-f)\b/i, 'Overwrites history on the remote'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|checkout\s+--\s|restore\s)/i, 'Throws away changes'],
  [/\b(rm|rmdir|unlink|shred)\s/i, 'Deletes files'],
  [/\b(del|erase|rd)\s+[/\\a-z0-9.*"']/i, 'Deletes files'],
  [/\bRemove-Item\b/i, 'Deletes files'],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b|\bdelete\s+from\b/i, 'Deletes data'],
  [/\b(mkfs|diskpart|format\s+[a-z]:)/i, 'Wipes a disk'],
  [/\b(shutdown|reboot|Restart-Computer|Stop-Computer)\b/i, 'Restarts or shuts down the machine'],
  [/\bdocker\s+(rm|rmi|volume\s+rm|system\s+prune)\b/i, 'Deletes containers or their data'],
];

/** The risk of a command, or null. `kind` is the ACP tool kind ('delete' is always a risk). */
export function riskOf(command: string | null | undefined, kind?: string): string | null {
  if (kind === 'delete') return 'Deletes files';
  if (!command) return null;
  for (const [re, what] of RISKS) if (re.test(command)) return what;
  return null;
}

export function permissionView(card: { title: string; why: string; toolCall?: { title?: string; kind?: string; rawInput?: unknown } | null }): PermissionView {
  const input = (card.toolCall?.rawInput ?? {}) as { command?: unknown; cmd?: unknown; description?: unknown };
  const raw = input.command ?? input.cmd;
  const command = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : card.toolCall?.title ? unquote(card.toolCall.title) : null;
  const reason = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null;
  const line = card.why.trim();
  // Newer servers send the reason as the line ("Push the release to GitHub."): show it once.
  const same = (a: string, b: string | null) => !!b && a.replace(/\.+$/, '') === b.replace(/\.+$/, '');
  const why = line && !OLD_WHY.test(line) && !same(line, reason) ? line : null;
  return { title: unquote(card.title), command: command?.trim() || null, reason, why, risk: riskOf(command, card.toolCall?.kind) };
}
