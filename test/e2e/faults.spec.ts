// Fault drills: what a person should see when the connection or the server misbehaves. Each one came from reading the
// code (19 Nov). Those that fail today are marked `test.fail()` with the reason, so CI stays green while they are
// tracked; when one is fixed its test passes, Playwright reports that as a failure, and the mark comes off.
import type { Page } from '@playwright/test';
import { assistantMessages, composer, connect, errorBanner, expect, knownFailure, newThread, openThread, reconnectPill, send, sendButton, sidebar, stopButton, test, threadRow, type FakeServer } from './support';

/** The session the first prompt went to. */
const promptedSession = (fake: FakeServer) => String(fake.callsOf('session/prompt')[0]?.params.sessionId);

/** Waits until the thread has connected again after a drop (a further session/load). */
async function reloaded(fake: FakeServer, before: number) {
  await expect.poll(() => fake.callsOf('session/load').length, { timeout: 15_000 }).toBeGreaterThan(before);
}

/** Records notifications instead of showing them, with notifications on and the window in the background. */
async function captureNotifications(page: Page) {
  await page.addInitScript(() => {
    const notes: { title: string; body?: string }[] = [];
    (window as unknown as { __notes: typeof notes }).__notes = notes;
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) { notes.push({ title, body: opts?.body }); }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    localStorage.setItem('hearth.notify.v1', 'on');
    document.hasFocus = () => false;
  });
  return () => page.evaluate(() => (window as unknown as { __notes: { title: string }[] }).__notes.map((n) => n.title));
}

test.describe('server restart', () => {
  test('the sidebar comes back by itself after a 4 s restart', async ({ page, fake }) => {
    knownFailure('directory.ts GIVE_UP_AFTER = 2: two failed retries (~3 s) turn the sidebar into "Not connected" and a key prompt that needs Retry');
    await connect(page, fake);
    await fake.restart(4000);
    await page.waitForTimeout(12_000); // the server has been back for 12 s
    await expect(sidebar(page).getByText('Not connected')).toBeHidden();
    await expect(sidebar(page).getByRole('button', { name: 'New key' })).toBeHidden();
    await expect(threadRow(page, 'Run the tests')).toBeVisible();
    await expect(sidebar(page)).toContainText('Connected to Fake Hearth');
  });

  test('the open thread comes back by itself after a 4 s restart', async ({ page, fake }) => {
    await connect(page, fake);
    const loads = fake.callsOf('session/load').length;
    await fake.restart(4000);
    await reloaded(fake, loads);
    await expect(reconnectPill(page)).toBeHidden();
    await send(page, 'Still there?');
    await expect(assistantMessages(page).last()).toContainText('You said: Still there?');
  });
});

test.describe('socket drop in the middle of a turn', () => {
  test('the turn still running on the server shows as running after the reconnect', async ({ page, fake }) => {
    knownFailure('acpThreadState.ts: a replayed turn is built as a finished "passive" message; nothing says the server still runs it, so no Stop and no running state');
    await connect(page, fake);
    await newThread(page, 'Scratch');
    await send(page, 'Count slowly #drop'); // 40 chunks, 200 ms apart; the socket drops after the fifth
    await expect(assistantMessages(page).last()).toContainText('Step 3 of 40');
    await reloaded(fake, 0);
    await expect(page.getByText('Step 12 of 40')).toBeVisible(); // the replay and the live stream carry on
    expect(fake.running(promptedSession(fake))).toBe(true);
    await expect(stopButton(page)).toBeVisible();
  });

  test('the composer does not send over a turn still running on the server', async ({ page, fake }) => {
    knownFailure('after the reconnect the app thinks the thread is idle, so Enter sends a new prompt and the server refuses it');
    await connect(page, fake);
    await newThread(page, 'Scratch');
    await send(page, 'Count slowly #drop');
    await reloaded(fake, 0);
    await expect(page.getByText('Step 10 of 40')).toBeVisible();
    expect(fake.running(promptedSession(fake))).toBe(true);
    await send(page, 'And another thing');
    await page.waitForTimeout(1000);
    // Either queued until the turn ends, or refused in the app: never sent over the running turn.
    expect(fake.callsOf('session/prompt').filter((c) => JSON.stringify(c.params.prompt).includes('And another thing')).length).toBe(0);
  });
});

test.describe('what is typed survives', () => {
  test('a draft survives a dropped connection', async ({ page, fake }) => {
    knownFailure('ThreadPane.tsx: the reconnect remounts the runtime (key={gen}), which empties the composer');
    await connect(page, fake);
    await composer(page).fill('A half-written thought');
    const loads = fake.callsOf('session/load').length;
    fake.dropAll();
    await reloaded(fake, loads);
    await expect(reconnectPill(page)).toBeHidden();
    await expect(composer(page)).toHaveValue('A half-written thought');
  });

  test('a message queued during a turn survives a dropped connection', async ({ page, fake }) => {
    knownFailure('ThreadPane.tsx: the queue lives in the remounted runtime and is dropped with it');
    await connect(page, fake);
    await newThread(page, 'Scratch');
    await send(page, 'Count a little #slow'); // 16 chunks, 4 s
    await expect(assistantMessages(page).last()).toContainText('Step 2 of 16');
    await send(page, 'Then say goodbye');
    await expect(page.getByText('Queued')).toBeVisible();
    const loads = fake.callsOf('session/load').length;
    fake.dropAll();
    await reloaded(fake, loads);
    // Sent once the turn ended, and answered (not sent over the running turn and refused).
    await expect(page.getByText('You said: Then say goodbye')).toBeVisible({ timeout: 15_000 });
  });

  test('a draft survives going to another thread and back', async ({ page, fake }) => {
    knownFailure('App.tsx: each thread pane is keyed by thread, so switching unmounts it and its composer');
    await connect(page, fake);
    await openThread(page, 'Run the tests');
    await composer(page).fill('Next: fix the open() filter');
    await openThread(page, 'Scratch notes');
    await openThread(page, 'Run the tests');
    await expect(composer(page)).toHaveValue('Next: fix the open() filter');
  });
});

test('a permission answered on another device stops asking here', async ({ page, fake }) => {
  knownFailure('AcpClient.ts: the server withdraws its request with $/cancel_request, which the client ignores, so the buttons stay live');
  await connect(page, fake);
  await newThread(page, 'Todo API');
  // Another device answers 1.5 s after the prompt shows; the command then runs for 8 s before it reports.
  await send(page, 'Run the tests #elsewhere');
  const yes = page.getByRole('button', { name: 'Yes', exact: true });
  await expect(yes).toBeVisible();
  await expect.poll(() => fake.threads.get(promptedSession(fake))?.cards.at(-1)?.decidedBy).toBe('another device');
  await expect(yes).toBeHidden({ timeout: 4000 });
});

test('a reply that never comes is reported', async ({ page, fake }) => {
  knownFailure('AcpClient.ts: session/prompt has no deadline and nothing watches for silence, so it spins for ever');
  await page.clock.install();
  await connect(page, fake);
  await newThread(page, 'Scratch');
  await send(page, 'Hello? #never');
  await expect(stopButton(page)).toBeVisible();
  await page.clock.fastForward('10:00'); // ten minutes of silence
  await expect(page.getByText(/no answer|not answering|lost|timed out/i)).toBeVisible({ timeout: 5000 });
});

test('a connection that went silent (half-open) is noticed', async ({ page, fake }) => {
  knownFailure('no heartbeat on either connection: a socket that stays open but silent still shows as connected');
  await page.clock.install();
  await connect(page, fake);
  fake.goSilent();
  await page.clock.fastForward('02:00');
  await expect(sidebar(page)).not.toContainText('Connected to Fake Hearth', { timeout: 5000 });
});

test('a failed "Needs you" refresh keeps the cards it had', async ({ page, fake }) => {
  knownFailure('directory.ts: any _hearth/cards error but "method not found" is turned into an empty list');
  await connect(page, fake);
  const needsYou = sidebar(page).getByRole('button', { name: /^Needs you/ });
  await expect(needsYou).toHaveText(/2$/);
  // The sidebar's own request (all cards, no sessionId) fails once; the open thread's request is left alone.
  const sidebarCalls = () => fake.callsOf('_hearth/cards').filter((c) => !c.params?.sessionId).length;
  const before = sidebarCalls();
  fake.failNext('_hearth/cards', { message: 'database is busy', match: (p) => !p?.sessionId });
  fake.notifyAll('_hearth/cards_changed', {});
  await expect.poll(sidebarCalls).toBeGreaterThan(before);
  expect(fake.errors.some((e) => e.method === '_hearth/cards')).toBe(true);
  await page.waitForTimeout(500);
  await expect(needsYou).toHaveText(/2$/);
});

test.describe('choices made before the first message', () => {
  test('a mode picked before the first message still shows after it', async ({ page, fake }) => {
    knownFailure('new: AcpClient.ts emits the session opening after set_mode, and the reducer then resets the mode to the one session/new reported');
    await connect(page, fake);
    await newThread(page, 'Todo API');
    await page.getByRole('button', { name: 'Mode: Ask' }).click();
    await page.getByRole('menuitem', { name: /^Plan/ }).click();
    await send(page, 'Plan the next feature');
    await expect(assistantMessages(page).last()).toContainText('Hello from the fake server');
    expect(fake.threads.get(fake.callsOf('session/prompt')[0].params.sessionId)?.modeId).toBe('plan'); // the thread is in Plan
    await expect(page.getByRole('button', { name: 'Mode: Plan' })).toBeVisible();
  });

  test('a mode the server refuses is reported, not silently dropped', async ({ page, fake }) => {
    knownFailure('AcpClient.ts: set_mode after session/new swallows errors (.catch(() => undefined)); the first turn runs in Ask');
    await connect(page, fake);
    await newThread(page, 'Todo API');
    await page.getByRole('button', { name: 'Mode: Ask' }).click();
    await page.getByRole('menuitem', { name: /^Plan/ }).click();
    fake.failNext('session/set_mode', { message: 'Plan mode is off for this project' });
    await send(page, 'Plan the next feature');
    await expect(assistantMessages(page).last()).toContainText('Hello from the fake server');
    await expect(page.getByText(/plan mode|mode/i).and(page.locator('[data-testid="error-banner"], [role="alert"]'))).toBeVisible();
  });

  test('a provider the server refuses is reported, not silently dropped', async ({ page, fake }) => {
    knownFailure('AcpClient.ts: _hearth/thread/provider after session/new swallows errors; the first turn runs on the default provider');
    await connect(page, fake);
    await newThread(page, 'Todo API');
    await page.getByRole('button', { name: 'Model: Auto' }).click();
    await page.getByRole('menuitem', { name: /^gemini/ }).first().click();
    fake.failNext('_hearth/thread/provider', { message: 'gemini is not allowed for this project' });
    await send(page, 'Which model are you?');
    await expect(assistantMessages(page).last()).toContainText('Hello from the fake server');
    await expect(page.getByText(/gemini|provider/i).and(page.locator('[data-testid="error-banner"], [role="alert"]'))).toBeVisible();
  });
});

test.describe('a long thread list', () => {
  test.use({ fakeOptions: { pageSize: 10 } });
  test('threads past the fifth page are not silently hidden', async ({ page, fake }) => {
    knownFailure('directory.ts MAX_PAGES = 5: the sidebar stops after five pages and says nothing');
    fake.addThreads('scratch', 60); // 67 threads, 7 pages of 10
    await connect(page, fake);
    await sidebar(page).getByRole('button', { name: /^Show \d+ more$/ }).last().click();
    await expect(threadRow(page, 'Old thread 43')).toBeVisible(); // the last one on page five
    await expect(threadRow(page, 'Old thread 60')).toBeVisible();
  });
});

test.describe('the error banner', () => {
  /** A dropped socket mid-turn puts up the banner, then the thread reconnects. */
  async function dropMidTurn(page: Page, fake: FakeServer) {
    await connect(page, fake);
    await newThread(page, 'Scratch');
    await send(page, 'Count slowly #drop');
    await reloaded(fake, 0);
    await expect(errorBanner(page)).toBeVisible();
  }

  test('says what happened in plain words', async ({ page, fake }) => {
    knownFailure('App.tsx shows the raw error: "ACP WebSocket connection closed"');
    await dropMidTurn(page, fake);
    await expect(errorBanner(page)).not.toHaveText(/ACP|WebSocket|JSON|-32\d{3}/);
  });

  test('can be dismissed', async ({ page, fake }) => {
    knownFailure('App.tsx: the banner has no close button; only opening another thread clears it');
    await dropMidTurn(page, fake);
    await errorBanner(page).getByRole('button', { name: /dismiss|close/i }).click({ timeout: 3000 });
    await expect(errorBanner(page)).toBeHidden();
  });

  test('goes away once the connection is back', async ({ page, fake }) => {
    knownFailure('App.tsx: nothing clears the banner when the thread reconnects');
    await dropMidTurn(page, fake);
    await expect(reconnectPill(page)).toBeHidden();
    await expect(errorBanner(page)).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('"Done" notifications', () => {
  test('a finished turn is announced', async ({ page, fake }) => {
    const notes = await captureNotifications(page);
    await connect(page, fake);
    await send(page, 'Say hi');
    await expect(assistantMessages(page).last()).toContainText('You said: Say hi');
    await expect.poll(notes).toContainEqual(expect.stringMatching(/^Done|turn finished/));
  });

  test('a stopped turn is not announced as done', async ({ page, fake }) => {
    knownFailure('ThreadPane.tsx Watch: any running -> idle change notifies "Done", a Stop included');
    const notes = await captureNotifications(page);
    await connect(page, fake);
    await send(page, 'Count slowly #long');
    await expect(assistantMessages(page).last()).toContainText('Step 2 of 60');
    await stopButton(page).click();
    await expect(sendButton(page)).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await notes()).not.toContainEqual(expect.stringMatching(/^Done|turn finished/));
  });

  test('a failed turn is not announced as done', async ({ page, fake }) => {
    knownFailure('ThreadPane.tsx Watch: an error ends the run like a success and notifies "Done"');
    const notes = await captureNotifications(page);
    await connect(page, fake);
    await send(page, 'Try it #error');
    await expect(sendButton(page)).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await notes()).not.toContainEqual(expect.stringMatching(/^Done|turn finished/));
  });
});

