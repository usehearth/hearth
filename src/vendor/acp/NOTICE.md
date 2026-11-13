# Vendored: assistant-ui ACP adapter

Source: https://github.com/assistant-ui/assistant-ui, `packages/acp/src` at commit 53ab9cbae076b569b37189795b93b71af0a40117 (12 Nov 2026).
Licence: MIT, Copyright (c) 2026 AgentbaseAI Inc. (see `LICENSE-assistant-ui`). Upstream marks this package private and unpublished, so Hearth keeps a pinned copy.
It matches `@assistant-ui/core` 0.3.35, `@assistant-ui/react` 0.15.36 and `assistant-stream` 0.3.57 (pinned in package.json).

## Hearth changes (search for "Hearth:")
- `acpThreadState.ts`: a passive mode. Updates that arrive outside this window's own turn (a `session/load` replay, or turns started in another window) become user and assistant messages instead of being dropped. The server owns the thread, so this is the normal case for Hearth.
- `AcpClient.ts`: `sessionId` opens an existing server session with `session/load`, and its replay is shown as history. `newSessionMeta` is sent as `_meta` on `session/new`.
- `AcpThreadController.ts`: an existing session opens on load, so its history shows before the first prompt.
- `AcpClient.ts` (H4): `extRequest` for server extension requests (`_hearth/plan`, `_hearth/cards`, `_hearth/card/answer`) and `subscribeExtNotification` for `_hearth/*` notifications.
- `acpThreadState.ts` (H4): updates carrying `_meta.hearth.card` are left out of the messages; Hearth draws them as cards.
- `globals.d.ts`: declares the build-time version constant.
