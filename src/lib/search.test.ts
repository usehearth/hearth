import { describe, expect, it } from 'vitest';
import { resultMeta, usefulSnippet } from './search';

const now = new Date(2026, 10, 20, 15, 0);

describe('search results', () => {
  it('say the project, when, and the words that matched', () => {
    expect(resultMeta({ project: 'Website', at: new Date(2026, 10, 20, 10, 30).toISOString(), snippet: 'the  backup\njob ran' }, now)).toBe('Website · today 10:30 · …the backup job ran…');
    expect(resultMeta({ project: 'Recipes', at: new Date(2026, 8, 1).toISOString(), dateOnly: true }, now)).toBe('Recipes · 1 Sep');
    expect(resultMeta({ project: null, at: null, snippet: null }, now)).toBe('');
  });
  it('drop a snippet that only repeats the title', () => {
    expect(usefulSnippet('Sourdough timing', 'Sourdough timing')).toBeNull();
    expect(usefulSnippet('Sourdough timing', '  sourdough   TIMING ')).toBeNull();
    expect(usefulSnippet('Sourdough timing', 'proof for about 4 hours')).toBe('proof for about 4 hours');
    expect(usefulSnippet('x', undefined)).toBeNull();
  });
});
