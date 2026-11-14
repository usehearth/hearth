// Checks the index.html rewriting in out/html.js (built by `npm run build`; `npm test` builds first).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { renderAppHtml, rewriteUrl } = require('../out/html.js');

const BASE = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/ext/media/app';
const CSP_SOURCE = 'https://*.vscode-cdn.net';
const NONCE = 'abc123NONCE';

// Shaped like the real dist/index.html (Vite, base "/").
const SAMPLE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>Hearth</title>
    <script>
      try { var t = localStorage.getItem('hearth.theme'); } catch (e) {}
    </script>
    <script type="module" crossorigin src="/assets/index-RZArmRck.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-BEnavp7R.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
  </head>
  <body>
    <div id="root"></div>
    <img src="./logo.svg" alt="">
  </body>
</html>`;

function check(html) {
  const out = renderAppHtml(html, { assetBase: BASE, cspSource: CSP_SOURCE, nonce: NONCE });

  // CSP meta present, first in head, with the nonce and the expected directives.
  const csp = out.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(csp, 'CSP meta present');
  assert.ok(out.indexOf(csp[0]) < out.indexOf('<script'), 'CSP comes before any script');
  for (const d of [
    "default-src 'none'",
    `script-src ${CSP_SOURCE} 'nonce-${NONCE}'`,
    `style-src ${CSP_SOURCE} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${CSP_SOURCE} https://fonts.gstatic.com`,
    `img-src ${CSP_SOURCE} data: blob:`,
    'connect-src ws: wss: http: https:',
    'frame-src blob: data:',
  ]) assert.ok(csp[1].includes(d), `CSP has ${d}`);

  // Every script tag carries the nonce.
  const scripts = out.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scripts.length >= 2, 'has scripts');
  for (const s of scripts) assert.ok(s.includes(`nonce="${NONCE}"`), `nonce on ${s}`);

  // No root-relative src/href left; local assets point at the webview base.
  assert.doesNotMatch(out, /\s(?:src|href)="\/(?!\/)/, 'no root-relative URLs remain');
  assert.doesNotMatch(out, /\bcrossorigin\b/, 'crossorigin stripped');
  assert.doesNotMatch(out, /rel="manifest"/, 'manifest link removed');
  return out;
}

test('rewrites sample index.html', () => {
  const out = check(SAMPLE);
  assert.ok(out.includes(`src="${BASE}/assets/index-RZArmRck.js"`));
  assert.ok(out.includes(`href="${BASE}/assets/index-BEnavp7R.css"`));
  assert.ok(out.includes(`href="${BASE}/logo.svg"`));
  assert.ok(out.includes(`href="${BASE}/apple-touch-icon.png"`));
  assert.ok(out.includes(`src="${BASE}/logo.svg"`), './ relative img rewritten');
  assert.ok(out.includes('href="https://fonts.googleapis.com"'), 'external URL untouched');
  assert.ok(out.includes(`window.__HEARTH_VSCODE__ = { assetBase: "${BASE}/" }`), 'bootstrap script present');
});

test('replaces an existing CSP and existing nonces', () => {
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><script nonce="old" src="/a.js"></script></head><body></body></html>`;
  const out = check(html);
  assert.equal((out.match(/Content-Security-Policy/g) ?? []).length, 1);
  assert.doesNotMatch(out, /nonce="old"/);
});

test('rewriteUrl leaves absolute and data URLs alone', () => {
  for (const u of ['https://x.y/a.js', 'data:image/png;base64,AA', 'blob:abc', '//cdn/x.js', '#top', ''])
    assert.equal(rewriteUrl(u, BASE), u);
  assert.equal(rewriteUrl('/assets/a.js', BASE + '/'), `${BASE}/assets/a.js`);
});

const realIndex = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'index.html');
test('rewrites the real dist/index.html when built', { skip: !existsSync(realIndex) && 'dist/index.html not built' }, () => {
  const out = check(readFileSync(realIndex, 'utf8'));
  assert.match(out, new RegExp(`src="${BASE.replace(/[.+%]/g, '\\$&')}/assets/index-[^"]+\\.js"`));
});
