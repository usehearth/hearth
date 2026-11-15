// Admin threads: what Hearth signs must be exactly what the runner checks. The expected values come from the runner's
// own functions (monolith runner/src/admin.ts: promptDigest, answerDigest), so a change on either side fails here.
import { describe, expect, it } from 'vitest';
import { answerDigest, forwardedPrompt, keyFingerprint, promptDigest } from './admin';

describe('admin signing matches the runner', () => {
  it('prompt digest: text and each image', async () => {
    expect(await promptDigest([{ type: 'text', text: 'Fix the runner, please.' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] as any))
      .toBe('256b6b57ce64c1384e44f872b53ab13a7233ef9f7cc75ab105db5b34d22da90f');
    expect(await promptDigest([{ type: 'text', text: 'pla' }, { type: 'text', text: 'in' }] as any))
      .toBe('f136cdeebc0e2e8f3c7024b17d58ffbf8a061eecdd027529ec8db720d8a09ce4');
  });
  it('card answer digest: request and option', async () => {
    expect(await answerDigest('req-1', 'allow')).toBe('25bdb060348b59bb199235dfda88816df127625a72923641c9e9685ce8587e9d');
  });
  it('the text is what the server forwards (links and text files inlined), and binary files are refused', () => {
    expect(forwardedPrompt([{ type: 'text', text: 'see' }, { type: 'resource_link', uri: 'file:///a.md', name: 'a.md' }, { type: 'resource', resource: { uri: 'file:///b.txt', text: 'B' } }] as any).text)
      .toBe('see\n[a.md](file:///a.md)\n<context ref="file:///b.txt">\nB\n</context>');
    expect(() => forwardedPrompt([{ type: 'resource', resource: { uri: 'file:///x.pdf', blob: 'AAAA' } }] as any)).toThrow(/text, images and text files/);
  });
  it('key fingerprint as the server shows it', async () => {
    expect(await keyFingerprint('ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=')).toMatch(/^[0-9a-f]{16}$/);
  });
});
