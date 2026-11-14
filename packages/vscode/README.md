# Hearth for VS Code

Hearth inside VS Code. The extension hosts the Hearth web app (threads, chat, settings) in a webview, so it talks to your
Hearth server over the same ACP WebSocket as the web and desktop builds. It adds:

- **Hearth: Open** (`hearth.open`): opens Hearth in an editor panel beside your code.
- **Hearth** in the activity bar: the same app in a sidebar view.
- **Hearth: Send selection to thread** (`hearth.sendSelection`, also in the editor right-click menu when text is selected):
  puts the selection into the composer as a fenced code block labelled with the file's workspace-relative path and lines:

  ````
  ```ts src/a.ts:10-20
  …selected code…
  ```
  ````

  A single line is labelled `src/a.ts:10`. If the selection contains backticks the fence is made longer.
- **Hearth: Open project thread** (`hearth.openProjectThread`): opens the panel (picking a session is not done yet).
- **Hearth: Open thread by session id** (`hearth.openThread`): asks the app to open a session; other extensions can call
  it as `vscode.commands.executeCommand('hearth.openThread', sessionId)`.
- **Hearth: Set device key for a server** (`hearth.setKey`): stores a server's device key in VS Code secret storage
  (empty input removes it). Mostly for setup; the app normally stores keys itself through the bridge.

Device keys are kept in VS Code's `SecretStorage` (the OS keychain), never in the webview's storage. The webview gets a
key only by asking for it over `postMessage`.

## Build

The extension ships a copy of the built web app in `media/app/`.

```sh
# 1. at the repo root: build the web app into dist/
npm ci
npm run build

# 2. in packages/vscode
cd packages/vscode
npm ci
npm run package        # -> hearth-<version>.vsix
```

`npm run package` runs `vsce package --no-dependencies`, which first runs `vscode:prepublish`
(`npm run build` = `tsc` to `out/`, then `npm run copy-app` = copy `../../dist/*` into `media/app/`).

Other scripts: `npm run build` (type-check and compile), `npm run watch`, `npm run copy-app`, `npm test` (compiles, then
checks the index.html rewriting in `test/html.test.mjs` with `node --test`).

To run it from source, open `packages/vscode` in VS Code after `npm run build && npm run copy-app` and press F5
(Run Extension), or install the .vsix.

## Install the .vsix

```sh
code --install-extension hearth-0.1.0.vsix
```

or in VS Code: Extensions view, `...` menu, **Install from VSIX...**.

## How the app is loaded

`media/app/index.html` (Vite build with `base: '/'`) is rewritten when the webview is created (`src/html.ts`):

- `src=` / `href=` values that are root-relative (`/assets/index-xxx.js`, `/logo.svg`) or `./`-relative are rewritten to
  `webview.asWebviewUri(media/app/...)`. External, `data:`, `blob:` and `#` URLs are left alone.
- A CSP `<meta>` is inserted first in `<head>` (any existing CSP meta is removed):
  `default-src 'none'; script-src <cspSource> 'nonce-…'; style-src <cspSource> 'unsafe-inline' https://fonts.googleapis.com;
  font-src <cspSource> https://fonts.gstatic.com; img-src <cspSource> data: blob:; connect-src ws: wss: http: https:;
  frame-src blob: data:;`
- Every `<script>` (including the inline theme script) gets the per-render nonce; `crossorigin` attributes are dropped.
- The `rel="manifest"` link is removed (a webview can't be installed, and `manifest-src` falls back to `'none'`).
- A small inline script sets `window.__HEARTH_VSCODE__ = { assetBase: "<webview URI of media/app>/" }` so the app can
  build URLs for its own files (see Known limits).

Panel and view both use `enableScripts: true`, `retainContextWhenHidden: true`, and `localResourceRoots: [media/app]`.

## App bridge

The messages between the extension and the app. All are plain JSON objects with a `type` string. The app side does
not exist in `src/` yet; it should, when `typeof acquireVsCodeApi === 'function'`:

1. call `acquireVsCodeApi()` **once** (VS Code throws on a second call) and keep the result,
2. `window.addEventListener('message', (e) => …)` for messages from the extension (`e.data`),
3. send `{ type: 'hearth.ready' }` once that listener is installed.

### Webview → extension (`vscodeApi.postMessage(msg)`)

| Message | Meaning |
| --- | --- |
| `{ type: 'hearth.ready' }` | The app's listener is installed. The extension queues `hearth.insert` / `hearth.openThread` until it gets this, then delivers them in order. Send it on every load (a reload of the webview starts a new page). |
| `{ type: 'hearth.getKey', serverId: string }` | Ask for the stored device key for `serverId` (the `Server.id` from `hearth.servers.v1`). Always answered with `hearth.key`. |
| `{ type: 'hearth.setKey', serverId: string, key: string }` | Store (replace) the key for `serverId` in SecretStorage. The key is trimmed; an empty key deletes the entry. No reply. |
| `{ type: 'hearth.deleteKey', serverId: string }` | Delete the stored key (for `forgetKey` / `removeServer`). No reply. |

`serverId` must be a non-empty string of at most 200 characters; other messages are ignored.

### Extension → webview (`window` `message` event, `event.data`)

| Message | Meaning |
| --- | --- |
| `{ type: 'hearth.key', serverId: string, key: string \| null }` | Reply to `hearth.getKey`; `null` when no key is stored. Match replies by `serverId` (several requests can be in flight). |
| `{ type: 'hearth.insert', text: string }` | Put `text` into the composer of the current thread (append at the cursor or end; don't send it). `text` is a fenced code block ending in a newline. |
| `{ type: 'hearth.openThread', sessionId: string }` | Open the thread for this ACP session id. |

Where messages go: the editor panel if it is open, otherwise the sidebar view if it is visible, otherwise a new panel
is opened (and the message waits for its `hearth.ready`).

### Sketch of the app side

```ts
// src/lib/vscode.ts (sketch)
declare const acquireVsCodeApi: undefined | (() => { postMessage(m: unknown): void });
export const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
export const isVsCode = !!vscodeApi;

const pending = new Map<string, ((key: string | null) => void)[]>();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'hearth.key') { for (const r of pending.get(m.serverId) ?? []) r(m.key); pending.delete(m.serverId); }
  else if (m.type === 'hearth.insert') { /* composer.insert(m.text) */ }
  else if (m.type === 'hearth.openThread') { /* openSession(m.sessionId) */ }
});
vscodeApi?.postMessage({ type: 'hearth.ready' });

export const getKey = (serverId: string) => new Promise<string | null>((r) => {
  pending.set(serverId, [...(pending.get(serverId) ?? []), r]);
  vscodeApi!.postMessage({ type: 'hearth.getKey', serverId });
});
export const setKey = (serverId: string, key: string) => vscodeApi?.postMessage({ type: 'hearth.setKey', serverId, key });
export const deleteKey = (serverId: string) => vscodeApi?.postMessage({ type: 'hearth.deleteKey', serverId });
```

In `src/lib/servers.ts` this would slot in next to the Tauri keychain path: read keys with `getKey` at start
(like `keysReady`), `setKey` from `storeKey`, `deleteKey` from `forgetKey` / `removeServer`.

## Known limits

- **Absolute paths inside the app's code.** Only `index.html` is rewritten. The app's JS uses `/logo.svg` directly
  (`<img src="/logo.svg">` in `App.tsx` and `AddServer.tsx`, the notification icon in `notify.ts`), which won't load in
  a webview. Fix on the app side with `import.meta.env.BASE_URL` plus `window.__HEARTH_VSCODE__?.assetBase`, or import
  the logo so Vite emits it under `/assets/` (but note JS-emitted asset URLs are also root-relative with `base: '/'`;
  building the copy for VS Code with `vite build --base ./` makes them relative to the module and avoids this).
- **Service worker.** `main.tsx` registers `/sw.js` in production builds; in a webview this fails (and is caught).
  `sw.js` and `manifest.webmanifest` are excluded from the .vsix. Skipping the registration when `acquireVsCodeApi`
  exists would be cleaner.
- **Server list storage.** The webview's `localStorage` (`hearth.servers.v1`, `hearth.theme`) works but VS Code does not
  promise to keep it; the server list may be lost (keys are safe in SecretStorage). Moving the list to
  `vscodeApi.getState/setState` or adding bridge messages for it would be more durable.
- **Theme.** The app uses its own light/dark theme, not the VS Code color theme.
- **Mixed content.** The webview is a secure context; plain `ws://` to a non-localhost server may be blocked by the
  webview runtime. Use `wss://` for remote servers.
- **No panel restore.** The panel is not restored after a window reload (no `WebviewPanelSerializer`); run
  **Hearth: Open** again.
- **Open project thread** only opens the panel; there is no session quick pick yet.
- The bridge (key storage, insert, open thread) does nothing until the app side above is implemented.

## License

Apache-2.0, same as the repository. See [LICENSE](LICENSE).
