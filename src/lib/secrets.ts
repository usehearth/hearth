// Skills, subagents, slash commands and the like that look like they hold a secret, or that name a client, never
// leave this computer: the import holds them back here and names them on the receipt. Same patterns as the server's
// runner (hearth-server runner/src/ccconfig.ts) and its scrubber; the server checks everything again before saving.

const SECRET: [string, RegExp][] = [
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ['an API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a sign-in token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a knowledge hub key', /\bkb_[0-9a-f]{64}\b/],
  ['a password in a web address', /:\/\/[^\s/:@]+:[^\s/@]{3,}@/],
  ['a bearer token', /bearer [A-Za-z0-9._~+/=-]{20,}/i],
  ['a long secret-looking number', /\b[0-9a-f]{48,}\b/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const ASSIGNMENT = /(?<![A-Za-z])(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']?((?![$<{%[(*])[^\s"'`,;)]{8,})/gi;
const PLACEHOLDER = /^(x{3,}|\*{3,}|redacted|changeme|example|your[_-].*|<.*>|\.\.\.|null|none|true|false|string|undefined)$/i;

/** What kinds of secret a text seems to hold, in words ("an API key"). Empty when none. */
export function secretHits(text: string): string[] {
  const hits = SECRET.filter(([, rx]) => rx.test(text)).map(([n]) => n);
  for (const m of text.matchAll(ASSIGNMENT)) {
    const v = m[1];
    if (PLACEHOLDER.test(v) || (!/\d/.test(v) && v.length < 16)) continue;
    hits.push('a password or token');
    break;
  }
  return hits;
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A matcher for client names (whole words, any case), or null when there are none. Terms under 3 letters are ignored. */
export function clientMatcher(terms: string[]): RegExp | null {
  const t = [...new Set(terms.map((x) => x.trim()).filter((x) => x.length >= 3))];
  return t.length ? new RegExp(`\\b(?:${t.map(esc).join('|')})\\b`, 'i') : null;
}

/** Why an item stays on this computer, or null when it can go. */
export function holdBack(name: string, content: string, files: Record<string, string> | null | undefined, client: RegExp | null): { reason: 'secret' | 'client'; detail: string } | null {
  const all = [content, ...Object.values(files ?? {})].join('\n');
  const hits = [...new Set(secretHits(all))];
  if (hits.length) return { reason: 'secret', detail: `it looks like it holds ${hits.join(' and ')}, so it stayed on this computer` };
  if (client && (client.test(all) || client.test(name))) return { reason: 'client', detail: 'it names a client, so it stayed on this computer' };
  return null;
}
