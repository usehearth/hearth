<p align="center"><img src="brand/logo.svg" width="96" alt="Hearth logo"></p>
<h1 align="center">Hearth</h1>
<p align="center"><b>Your AI, at home.</b> A polished chat app for any <a href="https://agentclientprotocol.com">ACP</a> server, where the server owns the chats.</p>

---

Hearth is a window onto your AI server. It keeps nothing itself: the sidebar is the server's own chat list (`session/list`), opening a thread replays it from the server (`session/load`), and a thread you start on one device is the same thread on every other one.

> **Status: v0.1, in daily use.** What it does today:
> - **Threads:** a live sidebar by project (pinned first), search, rename, pin, archive, delete; Edit, Regenerate and Rewind fork a thread at any turn (Rewind can also put the project's files back as they were).
> - **Chat:** streaming answers, slash commands from the agent (a `/` menu), edits as real diffs, shell commands as a terminal, a context and cost meter, the mode (Ask, Accept edits, Plan) and the model (provider, model, effort) per thread, live.
> - **Approvals:** permission prompts in the chat or as cards, with "Always allow" for a thread or a project; a Needs-you view; notifications when a turn ends or something needs you.
> - **Beside the chat:** the thread's living plan, the files it made (with previews), its subagents and running tasks.
> - **Settings:** servers and keys, model providers, connectors (MCP, OAuth sign-in), extensions (skills, slash commands, subagents, hooks), schedules, usage and budgets, the audit log, project settings (instructions, models, rules, tools, git remote, pull requests).
> - **Everywhere:** web, desktop (Windows, macOS, Linux), phone layout, a VS Code extension (`packages/vscode`), a command-line tool and an ACP bridge for editors (`packages/cli`), and a TypeScript SDK (`packages/sdk`).

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
- **Methods used:** `initialize`, `session/list` (paged), `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option`, plus `session/request_permission` from the server.
- **Hearth extensions:** a server lists the `_hearth/*` methods it has in `initialize` (`_meta.hearth.extensions`): plan, cards, files, threads (rename, pin, archive, delete, search, fork), modes, permissions (always allow, rules), usage, extensions, mcp (connectors, OAuth), git (push, pull requests), schedules, audit, project and device settings. Each screen shows only when its server has it.
- **Optional extras:** servers may add `_meta.hearth` on list items and updates (`project`, `projectName`, `kind: main | work`, `status`). Hearth groups threads by project with them; plain ACP servers still work, grouped by folder. `session/new` sends `_meta.hearth { project, main?, title? }`.

## Releases

A tag `v*` builds Windows, macOS and Linux installers on GitHub Actions (`.github/workflows/release.yml`) as a draft release, with signed self-updates when the signing secrets are set (see the workflow's header). Local builds don't need them.

## Privacy

- **No chat content on disk.** Hearth stores only server addresses and your theme choice. Chats stay in memory and on the server.
- **No telemetry,** none at all.
- **Keys:** the desktop app keeps each server's key in the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service). The web build holds it in memory for the window only.

## Built with

[assistant-ui](https://github.com/assistant-ui/assistant-ui) (its thread components and a vendored copy of its ACP adapter, see `src/vendor/acp/NOTICE.md`), React, Vite, Tailwind and the [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
