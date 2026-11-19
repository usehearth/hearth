# Setup guide: design

Status: phase 1 built (16 Nov 2026, branch `setup-guide`). Phases 2 and 3 not started.

## Phase 1 as built

| Part | Where |
|---|---|
| Model calls, keychain entry, address and Docker checks | `src-tauri/src/guide.rs` (commands `guide_check`, `guide_status`, `guide_call`, `guide_forget`, `guide_check_address`, `guide_check_docker`) |
| Provider formats, key detection and scrubbing, tools, the turn loop, the system prompt | `src/lib/guide.ts` |
| Checklist state (saved on this device, no keys) | `src/lib/setup.ts` |
| Screens | `src/components/hearth/Setup.tsx`, shown by `App.tsx` on the desktop when there are no servers or setup isn't finished |
| Tests | `src/lib/guide.test.ts` (15), `guide.rs` tests (10: both provider formats, plain errors and the address check against a fake HTTP provider, plus the real keychain flow) |
| Dev preview, made-up provider and server | `npm run dev`, then `/?reset#preview/setup` (`src/dev/SetupPreview.tsx`) |

Where it differs from the design below:

- **No streaming.** Each model call returns whole, with a "Thinking…" line meanwhile. Setup answers are short. Streaming can come later through Tauri events.
- **Its own small chat view**, not assistant-ui's runtime. It uses the app's Markdown component, so it still looks like Hearth. Tool calls show as one-line notes ("Checked the server address").
- **The key and its address are stored together** in the keychain entry `guide-provider`. The web view can only ask for a call to the one messages path. It can't read the key or send it to another address.
- **Server and address are one step.** The Server step ends with a working address (the `/healthz` check), so "I have an address already" just skips the install notes.
- **Import is a checklist step (19 Nov).** After "Model on the server", the checklist hands over to the app's own import view ([docs/import.md](import.md)) with a "Setting up Hearth, step 5 of 6" strip, the guide beside it, and Skip for now. Continue setup brings back the checklist for Done, which says what the import kept.
- **The guide works with a server too (19 Nov).** The import view shows the guide beside the import whenever this desktop keeps a guide key (Done's "keep the key" box, or "Add a model key" in the import view's guide panel). Without a key the import works the same.
- **The guide's model** defaults to Claude Haiku 5.5 (effort `low`) for Claude keys. For OpenAI-style endpoints it picks the first small chat model the endpoint lists. It can be changed in the guide's header, which starts the chat again.
- **Checked (17 Nov):**
  - The Rust calls run against a fake HTTP provider in both formats: paths, auth headers (`x-api-key` or bearer, none for a local model), the 401, credit, 429, non-JSON and empty-list errors, and `/healthz`.
  - `keychain_flow_with_a_fake_provider` covers the real keychain: check, status (never the key), a call with the stored key, a re-check that reuses it, and forget. It is skipped if a real guide key is already saved.
  - The Connect and Model steps (`serverCall`, `providerVerdict`) were run against hearth-server's throwaway `core/test/dev-server.ts`: health 200, connect, both providers reported working, and a wrong key refused.
  - The screens were checked again in the dev preview.
- **Not checked yet:** clicking through the desktop window itself, and a call to a real provider with a real key. Both need the person at the machine.


## The idea

When someone installs Hearth, it asks for a model key first. With that key the app can run a small assistant of its own. That assistant walks the person through the rest of the setup and answers their questions along the way. The rest of the setup is getting a server, connecting to it and importing history.

Today the order is the other way round. The app opens on "Add a server" and needs an address and a device key ([AddServer.tsx](../src/components/hearth/AddServer.tsx)). The server needs a model key in `.env` before it can do anything ([deploy/generic](../../hearth-server/deploy/generic/README.md)). So a new user does all the fiddly work before any AI can help. The guide moves the AI to the start.

## Decisions taken

- **The guide lives in the app** (desktop), not on the server. The server is usually the thing that isn't set up yet.
- **Validate the key straight away**, with one real call, before anything else happens.
- **The guide has tools.** It can check things itself, such as whether the server is up and whether the key works, instead of only answering in general terms.
- **It can be skipped and resumed.**
- **Keys go in the OS keychain** and never into the model's context.
- **A local model counts.** "No key, use a local model" sits on the first screen.

## What changes in the app's promise

Hearth today keeps nothing and calls nothing except your servers (README, Privacy). The guide adds one thing: during setup, the app calls the model provider *you* chose, with *your* key. The rules from Privacy stay the same:

- No chat content on disk. The guide's conversation stays in memory. Only the setup state is saved (see Resume), not what was said.
- No telemetry, and no Hearth-run service in between. The call goes from the app straight to the provider.
- The README's Privacy section gets one new line saying this.

## The flow

The setup is a **checklist**, and the guide sits beside it. The checklist is the source of truth. Every step can be done with its own buttons and fields, without chatting. The guide is there to help, explain and check, not to be the only way through. This keeps setup predictable, skippable and testable.

```
┌ Steps ───────────────┐ ┌ Guide ─────────────────────────────┐
│ ✓ Model key          │ │ Your key works (Claude, Haiku).    │
│ ● Server             │ │ Where will your server run?        │
│ ○ Connect            │ │  [This computer] [Another computer]│
│ ○ Model on server    │ │  [I have an address already]       │
│ ○ Import history     │ │                                    │
│                      │ │ > ask anything…                    │
│ Set up without help  │ └────────────────────────────────────┘
└──────────────────────┘
```

### 1. Model key (before any chat)

The first screen is a form, not a chat, because the chat can't run until the key works.

- **Provider:** Claude (Anthropic API), or OpenAI-compatible (OpenAI, OpenRouter, a gateway), or a local model (Ollama, LM Studio: the address only, no key). These are the same two kinds the server already understands (`anthropic`, `openai`, see `monolith/docs/providers.md`).
- **Key** (password field), with a "Get a key" link that opens the provider's console in the browser.
- **Check key** makes one small real call: a 1-token message, or `GET /v1/models` for OpenAI-compatible endpoints. That call also tells us which models the key can use.
- **Errors in plain words, on this screen:** "That key was refused", "That account has no credit", "Nothing answered at that address", "That address is not an Anthropic or OpenAI-style API". The key's own failure can never depend on the guide.
- **Model for the guide:** a fast, cheap one by default (Claude Haiku 5.5, or the first small model the endpoint lists). It can be changed. Setup is a few cents at most.
- Two exits that skip the guide: **"I already have a server"** opens today's AddServer, and **"Set up without help"** opens the checklist with no chat.

### 2. Server

"Where will your server run?"

- **This computer:** Docker on the same machine. In phase 1 the guide explains how and checks the result. In phase 2 the app does the install itself (see Phases).
- **Another computer I own:** the guide walks through `deploy/generic` on that machine. It works out the person's OS and Docker situation by asking, and gives the commands with copy buttons. The person runs them and the guide checks the result from the app (Is it reachable? Does `/healthz` answer?).
- **I have an address already:** go to Connect.

### 3. Connect

The address and device key go into secure fields in the checklist, never in the chat. **Connect** runs the same real `initialize` probe that AddServer uses today, then saves the server (address in local settings, key in the keychain, as now). If it fails, the guide gets the failure (without the key) and helps: wrong port, `ws` vs `wss`, firewall, key revoked, and so on.

### 4. Model on the server

The server needs its own provider. The guide checks `_hearth/providers` (any device key can read it):

- **The server already has a working provider:** tick and move on.
- **It has none:** the server starts without one and its sessions wait (`providers.ts`: "none configured; sessions wait until one is added"). The fix depends on the install:
  - *This computer (phase 2):* the app wrote the key into `.env` at install, so the server seeds it on first start. Nothing to do.
  - *Another computer:* the guide explains how to add the key to `.env` on that machine and restart. It does not send the key over the network for you, because a home server is often plain `ws://` on the LAN. (An admin device can also add providers in Settings, which already exists. The guide points there if the device has been ticked as admin.)
- The provider the server uses may differ from the guide's. That's fine.

### 5. Import history

The app's import view, "Bring everything from Claude" ([docs/import.md](import.md)), with the guide beside it. The checklist stays out of the way while it runs (App renders the import view while the step is `import`), with a strip to skip it or, once the receipt is in, to continue. The receipt's top line goes into setup's notes for Done.

### 6. Done

- A short summary: server, provider, what was imported.
- **"Keep the guide's key on this device?"** Default: **no**, and the key is removed from the keychain. This matches "keeps nothing". "Yes" keeps it for Help (phase 3).
- The app opens the server's main thread, as it does after AddServer today.

## The guide

### Where the model call runs

In Rust (a Tauri command), not in the webview:

- No CORS problems. Not every OpenAI-compatible endpoint allows browser calls, and Anthropic only does with a special header.
- The key goes from the form into the keychain (keychain entry `guide`, next to the server keys and the admin key in `lib.rs`), and Rust reads it from there for each call. The webview never holds the key after Check key.
- New dependency: `reqwest` (rustls). Two adapters, Anthropic Messages and OpenAI Chat Completions, both with tool calling and streaming. Tokens stream to the webview as Tauri events.
- Commands: `guide_key_check(kind, base_url, key)`, `guide_models()`, `guide_turn(messages, tools) → stream`, `guide_forget()`.

The tool loop runs in TypeScript. Rust only does the HTTP call, the keychain and the stream. This keeps the tools next to the app code they call.

### The chat UI

The chat reuses assistant-ui's thread components with a local runtime (`useExternalStoreRuntime`), so it looks and behaves like a normal Hearth thread. The messages live in React state only.

### What the guide knows

A system prompt that ships with the app, matched to its version:

- What Hearth is: the app, the server, ACP, device keys, providers.
- The install steps and the common failures (`deploy/generic/README.md` plus a troubleshooting list written for this).
- The person's OS, whether this is the desktop or web build, and the checklist state (which steps are done, which choices were made).
- Rules: short answers, follow the UX guide's wording, never ask for a key in the chat, suggest buttons rather than describing clicks.

### Tools

The guide checks things itself and *proposes* actions. Anything that changes something is a button the person clicks, not something the guide does on its own.

| Tool | What it does | Needs a click |
|---|---|---|
| `setup_state` | The checklist: steps, choices, last errors | no |
| `check_address(url)` | DNS, TCP, `/healthz`, TLS: what answered and how | no |
| `probe_server()` | The `initialize` probe with the saved address and key (the key stays in the keychain) | no |
| `server_providers()` | `_hearth/providers` with health | no |
| `check_docker()` | Is Docker installed and running here (desktop only) | no |
| `open_link(url)` | Opens a provider console or docs page in the browser (an allow-list of hosts) | no |
| `import_sources()` | What the import found: each Claude Code home in words (account, profiles, what it holds), each claude.ai export, what is held back, the plan. Counts and names, no content | no |
| `import_receipt()` | The latest receipt the server counted. Client names and Claude Code conversation titles are left out | no |
| `suggest(step, choice)` | Shows buttons in the chat that set a checklist choice | the person picks |
| `install_local()` | Phase 2: the local install (see below) | yes, a confirm card |

There is no tool that reads files, runs arbitrary commands or returns a secret. Tool results are scrubbed before the model sees them. Anything key-shaped is replaced with `‹key›`.

### Keys never reach the model

- Keys are typed only into password fields in the checklist.
- **Pasted into the chat by mistake:** before sending, the composer checks for key-shaped text (known prefixes such as `sk-ant-` and `sk-`, the device key format, and any long token with no spaces). If it finds some, it doesn't send. Instead it offers "This looks like a key. Put it in the key field instead?", and the person can move it there with one click.
- The local install's first device key is captured by the app and saved straight to the keychain. It is never shown to the model.

### Cost and limits

- A running cost line under the chat (tokens × the model's price where known, otherwise tokens only).
- A soft cap per setup (for example 300k tokens). Past it, the guide asks before going on.
- If the provider fails mid-setup, the chat says so plainly, and the checklist still works without it.

## Resume

- **Saved** (local settings, next to the server list): the current step, the choices (provider kind, base URL and model, "this computer" or "another computer", the server address), and whether the guide is on. Never keys, never the chat.
- **On reopen:** the checklist comes back where it was. The chat starts fresh with one opening line built from the state, such as "Welcome back. Last time we got your server running but couldn't connect. Want to try again?"
- Setup counts as finished once a server is saved and connected. From then on, the app opens normally.

## Web build

The guide is desktop only, because it needs Rust for the calls and the keychain. The web build keeps today's AddServer. Its first-run page links to the desktop download for a guided setup.

## Phases

1. **Guide and checklist.** The key screen, the Rust model calls and keychain, the chat with the read-only tools, the checklist steps 1, 3, 4 (checking only), 5 and 6, and "another computer" walked through by hand. This delivers the core idea.
2. **Install on this computer.** Prerequisite: **published server images** (for example on GHCR). `compose.yaml` builds core, the runner and the knowledge hub from source today (`build: context: ../..`), so a local install would need a git checkout and a long first build. With images, the app does what `install.sh` does, in TypeScript and Rust, with no bash (so it works on Windows):
   - check Docker;
   - write the compose file (shipped with the app, pinned to its version) into an app data folder;
   - make the random secrets;
   - write `.env` with the guide's key as the first provider;
   - `docker compose up -d`, then wait for `/healthz`;
   - log in and make the first device key, captured straight into the keychain;
   - save the server.

   The confirm card says what will be downloaded and how much disk it needs.
3. **Help when the server is down.** If the key was kept, a "Help" entry opens the guide outside setup. This is the one moment the server's own AI can't help. The tools are the same, plus recent connection errors.

## Testing

- **Unit tests:** key detection in the composer, scrubbing of tool results, the checklist state machine (every step reachable without the guide), and resume.
- **Rust:** the two provider adapters against a fake HTTP server (tool calls, streaming, 401/402/429/5xx mapped to the plain errors), and a keychain round trip for the `guide` entry (like `keychain_round_trip` in `lib.rs`).
- **Local harness:** a fake provider plus a throwaway server (in the style of `core/test/providers-local.ts`). Run a whole setup by script: bad key, good key, server unreachable, then reachable, connect, no provider, import. Save the result as evidence.
- **Phase 2:** a clean Windows VM with Docker Desktop, then a clean Linux VM, both installed through the app.

## Open questions

1. **The default model for the guide.** Haiku 5.5 is proposed when the key is Claude. Should the person pick, or is the default enough with a way to change it?
2. **Should the first device key from an install be an admin device?** Today the admin tick is web-login only (`server.ts`). If the first device were admin, the guide could add the server's provider over ACP instead of the person editing `.env` on the other machine. That's convenient, but it widens what a leaked first key can do, and it's a server change. Proposed: no for now. Revisit with phase 2.
3. **Publishing server images** (phase 2's prerequisite) is a server-repo decision: the registry, tags and the release workflow.
4. **The guide in the web build.** Possible later for Anthropic keys (direct browser access) and local models, but it would hold the key in the page's memory. Proposed: not now.
