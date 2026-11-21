// The guide beside a page (sandbox/reports/guide-plan.md, docs/setup-guide.md): which page it is on, and the one
// guard every page's data passes through before the guide's model sees it. The model may be a third-party service, so
// nothing it is shown may hold a key, a header or setting value, a client name or conversation text. Pages make sure of
// the last two by what they hand over (names and states, never content); this guard is the net under all of them.
import { scrub } from './guide';
import { clientMasker } from './receipt';

/** The pages the guide can sit beside. */
export type HelpPage = 'import' | 'connectors';

/** How the guide names each page to itself (in its prompt) and to the person. */
export const PAGE_NAMES: Record<HelpPage, string> = {
  import: 'Bring everything from Claude',
  connectors: 'Settings, Connectors',
};

/** A web address without what can carry a secret: no user or password, no query, no fragment. */
export function bareUrl(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname}`; }
  catch { return url.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//'); }
}
/** Text with every web address in it made bare (an error message can echo an address with its token). */
export function bareUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (m) => bareUrl(m));
}

/**
 * What the guide's model may be shown of a value: every string, and every object key, with web addresses made bare,
 * anything key-shaped replaced with ‹key›, and client names replaced with "a client".
 */
export function forModel<T>(v: T, clientTerms: string[]): T {
  const mask = clientMasker(clientTerms);
  const one = (s: string) => mask(scrub(bareUrls(s)));
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return one(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      // Two keys can hide to the same words ("Globex" and "Initech" both "a client"): number the repeats, keep both.
      const out: Record<string, unknown> = {};
      for (const [k, y] of Object.entries(x)) { const m = one(k); let key = m; for (let n = 2; key in out; n++) key = `${m} (${n})`; out[key] = walk(y); }
      return out;
    }
    return x;
  };
  return walk(v) as T;
}

/** A page's tools, each answer through forModel (the client names asked for at the time of the call). */
export function guardTools<T extends Record<string, unknown>>(tools: T, clientTerms: () => Promise<string[]>): T {
  return Object.fromEntries(Object.entries(tools).map(([name, fn]) => [name, typeof fn !== 'function' ? fn
    : async (...args: unknown[]) => forModel(await (fn as (...a: unknown[]) => unknown)(...args), await clientTerms())])) as T;
}
