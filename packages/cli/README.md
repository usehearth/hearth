# hearth CLI

Hearth from the terminal: list and search threads, chat, run one-shot prompts from scripts, and a stdio ACP bridge
so editors that run ACP agents can use a Hearth server as their agent. Built on `@hearth/sdk`.

Needs Node 22 or newer.

## Install

Build the SDK first (the CLI depends on it via `file:../sdk`), then the CLI, then install it globally:

```sh
cd packages/sdk && npm install && npm run build && cd ../..
cd packages/cli && npm install && npm run build && cd ../..
npm i -g ./packages/cli
hearth --version
```

## Log in

```sh
hearth login --url wss://ai.example/acp            # asks for the device key (not echoed)
echo "$KEY" | hearth login --url wss://ai.example/acp  # or pipe it in
hearth login --url wss://ai.example/acp --key "$KEY"   # or pass it (ends up in shell history)
```

`login` checks the key against the server, then saves URL and key to:

- Windows: `%APPDATA%\hearth\config.json`
- elsewhere: `~/.config/hearth/config.json` (mode 0600)

`HEARTH_URL` and `HEARTH_KEY` override the saved config. `http(s)://host` and bare `host:port` are accepted and turned
into `ws(s)://host/acp`.

## Commands

| Command | What it does |
| --- | --- |
| `hearth threads [--archived] [--json]` | Lists threads (every page of `session/list`). |
| `hearth search <query> [--json]` | Searches thread titles and content (`_hearth/threads/search`). |
| `hearth chat --project <p>` | Interactive chat in a new thread of project `<p>`. |
| `hearth chat --thread <id>` | Opens an existing thread (prints its history) and chats in it. |
| `hearth run -p "<prompt>" --project <p> \| --thread <id> [--json] [--allow-permissions]` | One turn, headless. |
| `hearth acp [--project <p>]` | stdio ACP bridge for editors (see below). |
| `hearth --help`, `hearth --version` | |

### chat

Prints the answer as it streams; tool calls show as `[tool: ...]` lines on stderr.

- `/exit` leaves, `/mode <default|acceptEdits|plan>` changes the thread's mode.
- Ctrl+C during a turn cancels it (`session/cancel`); otherwise it leaves.
- When the agent asks for permission you get `Allow <tool>? [y/N]`: `y` picks the first "allow once" option, anything
  else rejects.

### run

```sh
hearth run -p "Summarise yesterday's changes" --project home
hearth run -p "And the tests?" --thread 3eb7a090-... --json
# {"sessionId":"3eb7a090-...","stopReason":"end_turn","text":"..."}
```

Prints the answer text (or one JSON object with `--json`). Exit code 0 when the turn ends with `end_turn`, 1 otherwise
(2 for a usage error). Permission requests are refused (answered `cancelled`) unless `--allow-permissions` is given,
which picks the first "allow once" option.

### acp: use Hearth from an editor

`hearth acp` speaks ACP over stdio (newline-delimited JSON-RPC) and relays every message unchanged to and from the
server's WebSocket, so an editor that runs ACP agents as a subprocess can use Hearth as its agent. stdout carries only
protocol messages; diagnostics go to stderr. With `--project <p>`, a `session/new` that has no
`_meta.hearth.project` gets `p`, so new threads land in that project.

Log in first (`hearth login`) so the bridge finds the server without environment variables; editors don't always pass
your shell's environment to the agents they start.

The snippets below are **examples, not tested here**; check your editor's current documentation for the exact format.
On Windows, a global npm install creates `hearth.cmd`; if the editor can't start `hearth`, use `node` as the command
with the full path to `dist/cli.js` as the first argument.

Zed (`settings.json`, custom agent under `agent_servers`):

```json
{
  "agent_servers": {
    "Hearth": {
      "command": "hearth",
      "args": ["acp", "--project", "home"]
    }
  }
}
```

JetBrains IDEs (AI Assistant, custom ACP agent; for example in `~/.jetbrains/acp.json`):

```json
{
  "agent_servers": {
    "Hearth": {
      "command": "hearth",
      "args": ["acp", "--project", "home"]
    }
  }
}
```

Any other ACP client: run `hearth acp` as the agent command.

## Test

```sh
cd packages/cli
HEARTH_URL=ws://127.0.0.1:18900/acp HEARTH_KEY=... npm test
```

`npm test` runs `test/bridge-smoke.mjs`: it starts `hearth acp`, sends `initialize`, `session/new` and
`session/prompt`, and checks the answers and streamed updates come back on stdout. It skips when `HEARTH_URL` or
`HEARTH_KEY` is unset. `HEARTH_TEST_PROJECT` (default `home`) and `HEARTH_TEST_CWD` (default `C:/t/home`) pick the
project.
