# @hearth/sdk

A small typed client for a Hearth server: ACP (Agent Client Protocol) over a WebSocket, built on
`@agentclientprotocol/sdk`. Runs in Node 22+ (global `WebSocket`) and in browsers.

## Build

```sh
cd packages/sdk
npm install
npm run build   # tsc -> dist/ (with .d.ts)
```

## Example

```ts
import { connect } from '@hearth/sdk';

const hearth = await connect({ url: 'wss://ai.example/acp', key: process.env.HEARTH_KEY! });
console.log(hearth.agentInfo, hearth.extensions);

for (const t of await hearth.threads()) console.log(t.project, t.sessionId, t.title);

const thread = await hearth.newThread({ project: 'home', title: 'From the SDK' });
const { stopReason, text } = await thread.send('Hello!', {
  onText: (chunk) => process.stdout.write(chunk),
  onUpdate: (u) => { /* every session/update: tool calls, plan, usage... */ },
  // Return an optionId to allow; anything else answers "cancelled".
  onPermission: (req) => req.options.find((o) => o.kind === 'allow_once')?.optionId,
});

const old = await hearth.openThread(thread.sessionId); // session/load; history in old.messages
await old.setMode('plan');                             // default | acceptEdits | plan

const usage = await hearth.request('_hearth/usage', {}); // any _hearth/* method
hearth.close();
```

## API

- `connect({ url, key, clientName?, clientVersion?, WebSocket? }) → Promise<Hearth>`: opens the socket (the key goes
  as the `bearer.<key>` subprotocol next to `acp`) and runs `initialize`.
- `hearth.extensions: string[]`, `hearth.agentInfo`, `hearth.initializeResult`, `hearth.closed`.
- `hearth.threads({ archived? })`: every page of `session/list`, as `ThreadInfo[]`.
- `hearth.search(query)`: `_hearth/threads/search`, as `SearchResult[]` (`sessionId, project, title, snippet?`).
- `hearth.newThread({ project, title?, cwd?, main? })`: `session/new`. Without `cwd`, the project's folder is taken
  from the thread list.
- `hearth.openThread(sessionId, { cwd? })`: `session/load`; the replayed history is in `thread.messages`
  (`{ role: 'user' | 'assistant', text }[]`).
- `thread.send(text, { onText?, onUpdate?, onPermission? }) → Promise<{ stopReason, text }>`.
  Permission requests are answered `cancelled` unless `onPermission` returns one of the offered `optionId`s.
- `thread.cancel()`, `thread.setMode(mode)`.
- `hearth.request(method, params)`, `hearth.notify(method, params)`: any method, e.g. `_hearth/cards`,
  `_hearth/thread/rename`.
- `hearth.close()`.
