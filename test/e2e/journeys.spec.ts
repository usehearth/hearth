// The everyday journeys, against the fake server. These should all pass.
import { assistantMessages, composer, connect, expect, header, newThread, openThread, rememberServer, send, sendButton, sidebar, stopButton, test, threadRow, userMessages } from './support';
import { FALLBACK_LINE } from '../fake-server/fixtures.ts';

test('connect: add a server with its address and device key', async ({ page, fake }) => {
  await page.goto('/');
  await page.getByPlaceholder('wss://…').fill(fake.url);
  await page.getByPlaceholder('Paste the key').fill(fake.key);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(sidebar(page)).toContainText('Connected to Fake Hearth');
  // A new server that can import and holds no history yet offers the import wizard straight away.
  await expect(header(page)).toContainText('Import Claude history');
  await expect(threadRow(page, 'Run the tests')).toBeVisible();
});

test('connect: a wrong key is refused with a plain message', async ({ page, fake }) => {
  await page.goto('/');
  await page.getByPlaceholder('wss://…').fill(fake.url);
  await page.getByPlaceholder('Paste the key').fill('not-the-key');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert')).toHaveText("Can't reach the server, or it refused the key.");
});

test('connect: the key prompt unlocks a remembered server', async ({ page, fake }) => {
  await rememberServer(page, fake);
  await page.goto('/');
  await expect(sidebar(page)).toContainText(`Device key for Fake`);
  await page.getByPlaceholder('Paste the key').fill(fake.key);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(sidebar(page)).toContainText('Connected to Fake Hearth');
});

test('sidebar: lists projects, their threads and what needs you', async ({ page, fake }) => {
  await connect(page, fake);
  const side = sidebar(page);
  await expect(side.getByRole('button', { name: 'Todo API', exact: true })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Scratch', exact: true })).toBeVisible();
  for (const title of ['Count exports with a subagent', 'Run the tests', 'Fix the completed flag', 'Deploy notes', 'Scratch notes']) await expect(threadRow(page, title)).toBeVisible();
  // "Needs you" on a row is a dot now (the pill wrapped onto two lines); the row says it in its name and tooltip.
  await expect(threadRow(page, 'Deploy notes')).toHaveAccessibleName(/needs you/);
  await expect(threadRow(page, 'Run the tests')).not.toHaveAccessibleName(/needs you/);
  await expect(side.getByRole('button', { name: /Needs you/ })).toContainText('2');
});

test('sidebar: Recent lists every thread by time, with its project', async ({ page, fake }) => {
  await connect(page, fake);
  const side = sidebar(page);
  await side.getByRole('tab', { name: 'Recent' }).click();
  await expect(side.getByRole('tab', { name: 'Recent' })).toHaveAttribute('aria-selected', 'true');
  for (const title of ['Count exports with a subagent', 'Run the tests', 'Fix the completed flag', 'Deploy notes', 'Scratch notes']) await expect(threadRow(page, title)).toBeVisible();
  // Each row names its project, and the rows sit under time groups instead of project headings.
  await expect(threadRow(page, 'Scratch notes')).toHaveAccessibleName(/^Scratch notes · Scratch/);
  await expect(side.getByText(/^(Pinned|Today|Yesterday|Previous 7 days|Older)$/).first()).toBeVisible();
  await expect(side.getByRole('button', { name: 'Todo API', exact: true })).toBeHidden();
  await side.getByRole('tab', { name: 'Projects' }).click();
  await expect(side.getByRole('button', { name: 'Todo API', exact: true })).toBeVisible();
});

test('thread: opening one shows its history, tool calls included', async ({ page, fake }) => {
  await connect(page, fake);
  await openThread(page, 'Count exports with a subagent');
  await expect(userMessages(page).first()).toContainText('Use the Agent/Task tool');
  await expect(assistantMessages(page).last()).toContainText('src/todos.js');
  // A finished turn folds its tool calls into one line; opening it shows them, the subagent's own calls inside its call.
  await page.getByRole('button', { name: '6 tool calls' }).click();
  await page.getByRole('button', { name: 'Used tool: Count exports and list tests' }).click();
  await expect(page.getByLabel('What the subagent did')).toContainText('Read src/todos.js');
  expect(fake.callsOf('session/load').map((c) => c.params.sessionId)).toContain('t-subagent');
});

test('send: an answer streams in, with tool calls and the subagent calls nested inside', async ({ page, fake }) => {
  await connect(page, fake);
  await newThread(page, 'Todo API');
  await send(page, 'Count the exports with a subagent #subagent');
  await expect(userMessages(page).last()).toContainText('Count the exports');
  await expect(stopButton(page)).toBeVisible();
  await expect(assistantMessages(page).last()).toContainText('BG-DONE-42', { timeout: 15_000 });
  await expect(stopButton(page)).toBeHidden();
  await expect(sendButton(page)).toBeVisible();
  await page.getByRole('button', { name: /^\d+ tool calls$/ }).click();
  await page.getByRole('button', { name: 'Used tool: Count exports and list tests' }).click();
  const subagent = page.getByLabel('What the subagent did');
  await expect(subagent).toContainText('Read src/todos.js');
  await expect(subagent).toContainText('Read test/todos.test.js');
  // The new thread appears in the sidebar under its first message.
  await expect(threadRow(page, 'Count the exports with a subagent')).toBeVisible();
});

test('send: a long answer streams, and Stop ends it', async ({ page, fake }) => {
  await connect(page, fake);
  await newThread(page, 'Scratch');
  await send(page, 'Count slowly #long');
  const answer = assistantMessages(page).last();
  await expect(answer).toContainText('Step 2 of 60');
  await expect(answer).toContainText('Step 6 of 60');
  await stopButton(page).click();
  await fake.waitForCall('session/cancel');
  await expect(sendButton(page)).toBeVisible();
  const sessionId = fake.callsOf('session/prompt')[0].params.sessionId;
  await expect.poll(() => fake.running(sessionId)).toBe(false);
});

for (const [choice, outcome, after] of [
  ['Yes', 'approved', '0 tests ran'],
  ['No', 'denied', 'You said no, so I stopped there.'],
  ['Always allow the command `npm test` in this project', 'approved', 'From now on'],
] as const) {
  test(`permission: "${choice}" is sent and the turn goes on`, async ({ page, fake }) => {
    await connect(page, fake);
    await newThread(page, 'Todo API');
    await send(page, 'Run the tests #permission');
    await page.getByRole('button', { name: choice, exact: true }).click();
    await expect(assistantMessages(page).last()).toContainText(after, { timeout: 15_000 });
    // The server's "From now on" line is a notice, drawn as a quiet line.
    if (choice.startsWith('Always')) await expect(assistantMessages(page).last().getByRole('note')).toContainText('From now on:');
    const thread = fake.threads.get(fake.callsOf('session/prompt')[0].params.sessionId)!;
    expect(thread.cards.at(-1)).toMatchObject({ status: outcome, decidedBy: 'this window' });
  });
}

test('mode: Plan picked before the first message applies to that message', async ({ page, fake }) => {
  await connect(page, fake);
  await newThread(page, 'Todo API');
  await page.getByRole('button', { name: 'Mode: Ask' }).click();
  await page.getByRole('menuitem', { name: /^Plan/ }).click();
  await expect(page.getByRole('button', { name: 'Mode: Plan' })).toBeVisible();
  await send(page, 'Plan the next feature');
  await expect(assistantMessages(page).last()).toContainText('Hello from the fake server');
  const order = fake.calls.map((c) => c.method).filter((m) => ['session/new', 'session/set_mode', 'session/prompt'].includes(m));
  expect(order).toEqual(['session/new', 'session/set_mode', 'session/prompt']);
  expect(fake.callsOf('session/set_mode')[0].params.modeId).toBe('plan');
  expect(fake.threads.get(fake.callsOf('session/prompt')[0].params.sessionId)?.modeId).toBe('plan');
});

test('slash menu: "/" on a new thread lists the project commands', async ({ page, fake }) => {
  await connect(page, fake);
  await newThread(page, 'Todo API');
  await composer(page).fill('/');
  const menu = page.getByRole('listbox', { name: 'Slash commands' });
  await expect(menu.getByRole('option')).toHaveCount(4);
  await composer(page).fill('/co');
  await expect(menu.getByRole('option')).toHaveText([/\/compact/, /\/context/]);
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('/compact ');
});

test('notice: a server line (provider fallback) is a quiet line apart from the answer, live and after reopening', async ({ page, fake }) => {
  await connect(page, fake);
  await newThread(page, 'Todo API');
  await send(page, 'Check the build #fallback');
  const check = async () => {
    const answer = assistantMessages(page).last();
    await expect(answer).toContainText('Done: the tests pass.');
    await expect(answer.getByRole('note')).toHaveText(FALLBACK_LINE);
    // Not the agent's words: the answer's Markdown holds only the agent's text.
    await expect(answer.locator('.aui-md')).toHaveCount(1);
    await expect(answer.locator('.aui-md')).not.toContainText('overloaded');
  };
  await check();
  await openThread(page, 'Scratch notes');
  await openThread(page, 'Check the build');
  await check();
});

test('switch: going to another thread and back shows the first one again', async ({ page, fake }) => {
  await connect(page, fake);
  await openThread(page, 'Run the tests');
  await expect(assistantMessages(page).last()).toContainText('0 tests ran');
  await openThread(page, 'Scratch notes');
  await expect(userMessages(page).last()).toContainText('Take a note');
  await openThread(page, 'Run the tests');
  await expect(assistantMessages(page).last()).toContainText('0 tests ran');
  await expect(userMessages(page)).toHaveCount(1);
});

test('archive: a thread leaves the list and comes back from Archived', async ({ page, fake }) => {
  await connect(page, fake);
  await threadRow(page, 'Scratch notes').hover();
  await sidebar(page).getByRole('button', { name: 'More for Scratch notes' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(threadRow(page, 'Scratch notes')).toBeHidden();
  expect(fake.callsOf('_hearth/thread/archive')[0].params).toMatchObject({ sessionId: 't-notes', archived: true });
  await sidebar(page).getByRole('button', { name: 'Archived threads' }).click();
  const archived = sidebar(page).getByRole('list', { name: 'Archived threads' });
  await expect(archived).toContainText('Scratch notes');
  await archived.getByRole('button', { name: 'Unarchive Scratch notes' }).click();
  await expect(sidebar(page)).toContainText('Nothing archived.');
  await sidebar(page).getByRole('button', { name: 'Back' }).click();
  await expect(threadRow(page, 'Scratch notes')).toBeVisible();
});

test('delete: an open thread is deleted, closed and gone from the list', async ({ page, fake }) => {
  await connect(page, fake);
  await openThread(page, 'Deploy notes');
  await sidebar(page).getByRole('button', { name: 'More for Deploy notes' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Deploy notes”?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(threadRow(page, 'Deploy notes')).toBeHidden();
  await expect(header(page)).toContainText('Pick a thread');
  expect(fake.threads.get('t-waiting')?.deleted).toBe(true);
});

test('search: one box finds threads and imported history, with project, date and the words that matched', async ({ page, fake }) => {
  await connect(page, fake);
  const side = sidebar(page);
  await side.getByRole('textbox', { name: 'Search threads and history' }).fill('deploy');
  const threads = side.getByRole('region', { name: 'Threads' });
  const past = side.getByRole('region', { name: 'Imported history' });
  await expect(threads.getByRole('button', { name: /^Deploy notes/ })).toBeVisible();
  await expect(past.getByRole('button', { name: /Deploy checklist from Claude Code/ })).toContainText(/Todo API · 2 Sep( 2026)? ·/); // the year shows only in another year (the guide's dates)
  await expect(past).toContainText('…run the migration before you deploy…');
  await threads.getByRole('button', { name: /^Deploy notes/ }).click();
  await expect(header(page)).toContainText('Deploy notes');
  expect(fake.callsOf('_hearth/history/search').map((c) => c.params.query)).toContain('deploy');
});

test('settings: Connectors and Extensions list what the server has', async ({ page, fake }) => {
  await connect(page, fake);
  await sidebar(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('button', { name: 'Connectors' }).click();
  await expect(page.getByRole('main')).toContainText('Linear');
  await expect(page.getByRole('main')).toContainText('Azure DevOps');
  await nav.getByRole('button', { name: 'Extensions' }).click();
  // Installed extensions are grouped by where they came from, each group folded until opened.
  await page.getByRole('button', { name: /^Added here 2/ }).click();
  await expect(page.getByRole('main')).toContainText('standup');
  await expect(page.getByRole('main')).toContainText('house-style');
  expect(fake.unknown).toEqual([]);
});

test('import: a claude.ai export goes through review to done', async ({ page, fake }) => {
  await connect(page, fake);
  await sidebar(page).getByRole('button', { name: 'Import Claude history' }).click();
  await expect(page.getByText('Import your Claude history')).toBeVisible();
  const conversations = [1, 2].map((n) => ({
    uuid: `chat-${n}`, name: `Chat ${n}`, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T11:00:00Z',
    chat_messages: [{ uuid: `m${n}a`, sender: 'human', text: `Question ${n}`, created_at: '2026-10-01T10:00:00Z' }, { uuid: `m${n}b`, sender: 'assistant', text: `Answer ${n}`, created_at: '2026-10-01T10:01:00Z' }],
  }));
  await page.locator('input[type=file]').setInputFiles({ name: 'conversations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(conversations)) });
  await expect(page.getByText('2 chats')).toBeVisible();
  await page.getByRole('button', { name: 'Look through them' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Claude chats');
  await page.getByRole('button', { name: 'Import and make 1 project' }).click();
  await expect(page.getByText('Imported 2 conversations, made 1 projects.')).toBeVisible();
  expect(fake.callsOf('_hearth/import/commit')).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Open Hearth' })).toBeVisible();
});
