// What is being typed in each thread, kept while the window is open: switching to another thread and back, or a
// reconnect (which makes the thread's runtime anew), finds the draft where it was. Memory only, never on disk:
// Hearth keeps no chat content on the device.
const drafts = new Map<string, string>();

export const draftOf = (key: string): string => drafts.get(key) ?? '';

export function keepDraft(key: string, text: string): void {
  if (text.trim()) drafts.set(key, text);
  else drafts.delete(key);
}

/** A new thread's draft follows it once the server gives it an id. */
export function moveDraft(from: string, to: string): void {
  const text = drafts.get(from);
  if (text === undefined) return;
  drafts.delete(from);
  if (!drafts.has(to)) drafts.set(to, text);
}
