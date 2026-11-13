// Turns the built web app's index.html (dist/index.html, built with base "/") into HTML a VS Code webview can load:
// asset URLs point at webview resource URIs, every <script> carries the nonce, and a strict CSP is the first thing in <head>.
// No `vscode` import here so it can be tested with plain node.

export interface RenderOptions {
  /** Webview URI of the media/app folder, as a string (from webview.asWebviewUri), with or without a trailing slash. */
  assetBase: string;
  /** webview.cspSource */
  cspSource: string;
  /** Random nonce for this render; every <script> gets it. */
  nonce: string;
}

export function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${cspSource} https://fonts.gstatic.com`,
    `img-src ${cspSource} data: blob:`,
    `connect-src ws: wss: http: https:`,
    `frame-src blob: data:`,
  ].join('; ') + ';';
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Maps a path from the built app ("/assets/x.js", "./logo.svg", "logo.svg") to a webview URI; leaves other URLs alone. */
export function rewriteUrl(url: string, assetBase: string): string {
  const base = assetBase.replace(/\/+$/, '');
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url) || url === '') return url; // http:, data:, blob:, //host, #frag
  const path = url.replace(/^\.?\//, '');
  return `${base}/${path}`;
}

export function renderAppHtml(indexHtml: string, opts: RenderOptions): string {
  const { assetBase, cspSource, nonce } = opts;
  let html = indexHtml;

  // Drop any CSP the app ships and the web manifest (manifest-src is 'none' here, and a webview can't be installed).
  html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '');
  html = html.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>\s*/gi, '');

  // Rewrite src= / href= on tags (scripts, stylesheets, icons, images).
  html = html.replace(/<(script|link|img|source|audio|video)\b[^>]*>/gi, (tag) =>
    tag.replace(/\s(src|href)=(["'])(.*?)\2/gi, (_m, attr: string, q: string, value: string) => ` ${attr}=${q}${rewriteUrl(value, assetBase)}${q}`),
  );

  // Resource URIs are cross-origin to the webview document; `crossorigin` is not needed (module scripts use CORS anyway)
  // and on a stylesheet it would only make loading stricter.
  html = html.replace(/<(script|link)\b[^>]*>/gi, (tag) => tag.replace(/\s+crossorigin(?:=(["']).*?\1)?(?=[\s>/])/gi, ''));

  // Nonce on every script tag (replacing any existing one).
  html = html.replace(/<script\b([^>]*)>/gi, (_m, attrs: string) => {
    const rest = attrs.replace(/\s+nonce=(["']).*?\1/gi, '');
    return `<script nonce="${nonce}"${rest}>`;
  });

  // CSP first in <head>, plus a tiny inline script telling the app where its files are (for /logo.svg-style paths in code).
  const csp = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(buildCsp(cspSource, nonce))}">`;
  const base = assetBase.replace(/\/+$/, '');
  const boot = `<script nonce="${nonce}">window.__HEARTH_VSCODE__ = { assetBase: ${JSON.stringify(base + '/')} };</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (h) => `${h}\n    ${csp}\n    ${boot}`);
  } else {
    html = `${csp}\n${boot}\n${html}`;
  }
  return html;
}

/** Shown when media/app/index.html is missing (the app was not built and copied in). */
export function missingAppHtml(cspSource: string, nonce: string): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttr(buildCsp(cspSource, nonce))}"></head>
<body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem">
<h3>Hearth app not found</h3>
<p>This build of the extension does not include the web app. Run <code>npm ci &amp;&amp; npm run build</code> at the repo root, then <code>npm run copy-app</code> in <code>packages/vscode</code>, and reload.</p>
</body></html>`;
}
