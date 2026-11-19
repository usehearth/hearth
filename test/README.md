# User-journey tests

The app as a person uses it, in a real browser, against a fake server that behaves like a Hearth server and can be
made to misbehave.

```bash
npx playwright install chromium   # once
npx playwright test               # all journeys and fault drills (starts Vite on port 5191)
npx playwright test --ui          # watch them run
E2E_IGNORE_KNOWN=1 npx playwright test test/e2e/faults.spec.ts   # see each known failure fail
E2E_PORT=5193 npx playwright test # another Vite port, when 5191 is taken (another checkout running the tests)
```

## What is here

- `fake-server/`: ACP over a WebSocket with the `_hearth/*` methods a normal session uses (list, new, load, prompt,
  cancel, modes, cards, plan, files, providers, threads, connectors, extensions, import). The server owns the threads, as
  the real one does: a turn keeps running when a socket drops, and `session/load` replays everything said so far.
  - `fixtures/*.jsonl`: real turns recorded from a sandbox Hearth server (a subagent, a permission prompt, a plan with
    edits), cleaned of private details. `fixtures.ts` also makes up a few (a long answer, one that never comes, an error).
  - A prompt picks its script with a tag: `#subagent`, `#permission`, `#plan-and-edits`, `#long` (15 s), `#slow` (4 s),
    `#drop` (the socket drops mid-turn), `#never`, `#error`, `#elsewhere` (another device answers the permission).
    Anything else gets a short hello.
  - Faults, from a test: `dropAll()`, `restart(ms)`, `setDelay(ms)`, `blackhole(method)`, `failNext(method)`,
    `goSilent()` (a half-open socket), `answerElsewhere(sessionId)`, `addThreads(project, n)`.
  - By hand: `node test/fake-server/cli.ts`, then `npm run dev` and add the address and key it prints.
- `e2e/journeys.spec.ts`: the everyday journeys. All should pass.
- `e2e/faults.spec.ts`: fault drills, each saying what a person should see. Those that fail today are marked
  `knownFailure('reason')`: they count as passing while they fail, and turn red when fixed, so the mark comes off with
  the fix.

Unit tests for the connection code sit beside it: `src/vendor/acp/AcpClient.test.ts` (with an in-memory socket) and
`src/vendor/acp/acpThreadState.test.ts` (the thread reducer). Known gaps there are `it.fails`.
