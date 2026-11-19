// Shared pieces for the journeys: a fake server per test, and the steps a person takes (connect, open, send).
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { startFakeServer, type FakeServer, type FakeServerOptions } from '../fake-server/server.ts';

export { expect };
export type { FakeServer };

export const test = base.extend<{ fakeOptions: FakeServerOptions; fake: FakeServer }>({
  fakeOptions: [{}, { option: true }],
  fake: async ({ fakeOptions }, use) => {
    const fake = await startFakeServer(fakeOptions);
    await use(fake);
    await fake.close();
  },
});

export const SERVER_NAME = 'Fake';

/** The web build remembers server addresses (never keys): start with this one known, as after an earlier visit. */
export async function rememberServer(page: Page, fake: FakeServer) {
  await page.addInitScript(([url, name]) => {
    if (!localStorage.getItem('hearth.servers.v1')) localStorage.setItem('hearth.servers.v1', JSON.stringify([{ id: 'fake', name, url }]));
  }, [fake.url, SERVER_NAME]);
}

/** Opens the app with the server known and types the device key into the key prompt, as a person does on the web. */
export async function connect(page: Page, fake: FakeServer, opts: { waitForThread?: boolean } = {}) {
  await rememberServer(page, fake);
  await page.goto('/');
  await page.getByPlaceholder('Paste the key').fill(fake.key);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(sidebar(page)).toContainText('Connected to Fake Hearth');
  // The most recent project's main thread opens by itself.
  if (opts.waitForThread !== false) await expect(header(page)).toContainText('Main thread');
}

export const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Threads' });
export const header = (page: Page) => page.locator('main > header');
export const composer = (page: Page) => page.getByRole('textbox', { name: 'Message input' });
export const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message' });
export const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop generating' });
export const userMessages = (page: Page) => page.locator('[data-role="user"]');
export const assistantMessages = (page: Page) => page.locator('[data-role="assistant"]');
/** The red banner above the thread (App.tsx). */
export const errorBanner = (page: Page) => page.getByTestId('error-banner');
/** The pill at the top of the thread while its connection is down (ThreadPane.tsx). */
export const reconnectPill = (page: Page) => page.locator('main').getByRole('status').filter({ hasText: /Reconnecting|Disconnected/ });

/** A thread row in the sidebar, by its title. */
export const threadRow = (page: Page, title: string): Locator => sidebar(page).getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

export async function openThread(page: Page, title: string) {
  await threadRow(page, title).click();
  await expect(header(page)).toContainText(title);
}

/** Types a message and sends it with Enter. */
export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

/** Starts a new thread in a project with the + next to it. */
export async function newThread(page: Page, projectName: string) {
  await sidebar(page).getByRole('button', { name: `New thread in ${projectName}` }).click();
  await expect(header(page)).toContainText('New thread');
}

/**
 * Marks a test as a known failure: it must fail, so CI stays green while the fault is tracked, and a fix makes it
 * "unexpectedly pass" (red) until the mark comes off. `E2E_IGNORE_KNOWN=1` runs them as plain tests, to see each one fail.
 */
export const knownFailure = (reason: string) => test.fail(!process.env.E2E_IGNORE_KNOWN, reason);
