import { expect, it } from 'vitest';
import { draftOf, keepDraft, moveDraft } from './drafts';

it('keeps a draft per thread, and forgets an empty one', () => {
  keepDraft('a', 'half a thought');
  keepDraft('b', 'another');
  expect(draftOf('a')).toBe('half a thought');
  keepDraft('a', '   ');
  expect(draftOf('a')).toBe('');
  expect(draftOf('b')).toBe('another');
});

it("a new thread's draft follows it to its session id, without overwriting one already there", () => {
  keepDraft('new:1', 'first message');
  moveDraft('new:1', 's1');
  expect(draftOf('new:1')).toBe('');
  expect(draftOf('s1')).toBe('first message');
  keepDraft('s2', 'kept');
  keepDraft('new:2', 'other');
  moveDraft('new:2', 's2');
  expect(draftOf('s2')).toBe('kept');
});
