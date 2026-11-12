<p align="center"><img src="brand/logo.svg" width="96" alt="Hearth logo"></p>
<h1 align="center">Hearth</h1>
<p align="center"><b>Your AI, at home.</b> A polished chat app for any <a href="https://agentclientprotocol.com">ACP</a> server, where the server owns the chats.</p>

---

Hearth is a window onto your AI server. It keeps nothing itself: the sidebar is the server's own chat list (`session/list`), opening a thread replays it from the server (`session/load`), and a thread you start on one device is the same thread on every other one.

> **Status: early (v0.1).** Connects to an ACP server over WebSocket, lists its threads by project, opens and replays a thread, chats, and answers permission prompts. The live sidebar, plan panel and cards are next.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5178
```

### Desktop app (Tauri)

Needs Rust and, on Windows, the Visual Studio C++ build tools ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
npm run desktop          # dev window
npm run desktop:build    # installers in src-tauri/target/release/bundle
```

Add a server: its address (for example `wss://ai.home.example`, or `host:port`; `/acp` is added) and a device key made on that server.

## How it talks to a server

- **Transport:** ACP over one WebSocket, per the ACP remote transport RFD. The key goes as a `bearer.<key>` WebSocket subprotocol, because browsers can't set headers.
- **Methods used:** `initialize`, `session/list`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, plus `session/request_permission` from the server.
- **Optional extras:** servers may add `_meta.hearth` on list items and updates (`project`, `projectName`, `kind: main | work`, `status`). Hearth groups threads by project with them; plain ACP servers still work, grouped by folder. `session/new` sends `_meta.hearth { project, main?, title? }`.

## Privacy

- **No chat content on disk.** Hearth stores only server addresses and your theme choice. Chats stay in memory and on the server.
- **No telemetry,** none at all.
- **Keys:** the desktop app keeps each server's key in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service). The web build holds it in memory for the window only.

## Built with

[assistant-ui](https://github.com/assistant-ui/assistant-ui) (its thread components and a vendored copy of its ACP adapter, see `src/vendor/acp/NOTICE.md`), React, Vite, Tailwind and the [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
