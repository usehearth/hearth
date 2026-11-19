// Tool names as people read them. MCP tools arrive as "mcp__<server>__<tool>" (and nested when a proxy wraps them:
// "mcp__oc__mcp__tides__get_tide"); the thread shows "browser: navigate", "tides: get tide" instead.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "mcp__browser__browser_take_screenshot" -> "browser: take screenshot". Anything else is returned as it was. */
export function readableToolName(name: string): string {
  const m = /^mcp__(\S+)([\s\S]*)$/.exec(name.trim());
  if (!m) return name;
  let parts = m[1].split('__').filter(Boolean);
  // A proxy's own prefix ("oc", "mcp"): keep the innermost server and tool.
  const inner = parts.lastIndexOf('mcp');
  if (inner >= 0 && parts.length - inner > 2) parts = parts.slice(inner + 1);
  if (parts.length < 2) return name;
  const server = parts[parts.length - 2], tool = parts[parts.length - 1];
  // Tools often repeat their server's name ("browser_navigate", "taiga-taiga_issues_list"); say it once.
  let words = tool.replace(/[_-]+/g, ' ').trim();
  const s = server.replace(/[_-]+/g, ' ').trim();
  while (s && new RegExp(`^${esc(s)}\\s+`, 'i').test(words)) words = words.replace(new RegExp(`^${esc(s)}\\s+`, 'i'), '');
  const first = words.split(' ')[0];
  if (first && new RegExp(`^${esc(first)}\\s+${esc(first)}\\b`, 'i').test(words)) words = words.slice(first.length).trim();
  return `${s}: ${words || tool}${m[2]}`;
}
