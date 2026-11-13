import { describe, expect, it } from 'vitest';
import { commandOf, diffRows, diffStats, exitCodeOf, outputOf, stripAnsi } from './ToolViews';
import { matchCommands, slashQuery } from './SlashMenu';
import { toolCallContentToText } from '@/vendor/acp/conversions';

describe('diffs', () => {
  it('numbers old and new lines and marks adds and removes', () => {
    const rows = diffRows('a\nb\nc\n', 'a\nB\nc\n');
    expect(rows).toEqual([
      { kind: 'ctx', a: 1, b: 1, text: 'a' },
      { kind: 'del', a: 2, text: 'b' },
      { kind: 'add', b: 2, text: 'B' },
      { kind: 'ctx', a: 3, b: 3, text: 'c' },
    ]);
    expect(diffStats('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ add: 1, del: 1 });
  });
  it('folds long unchanged runs', () => {
    const old = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') + '\n';
    const rows = diffRows(old, old.replace('l15\n', 'L15\n'));
    expect(rows.some((r) => r.kind === 'gap')).toBe(true);
    expect(rows.filter((r) => r.kind !== 'gap').length).toBeLessThan(12);
  });
  it('a new file is all adds', () => {
    expect(diffStats('', 'x\ny\n')).toEqual({ add: 2, del: 0 });
  });
  it('the text fallback keeps the old text (it used to drop it)', () => {
    const t = toolCallContentToText([{ type: 'diff', path: 'a.ts', oldText: 'one\n', newText: 'two\n' } as never])!;
    expect(t).toContain('-one');
    expect(t).toContain('+two');
  });
});

describe('terminal', () => {
  it('strips colours and reads the command, output and exit code', () => {
    expect(stripAnsi('\u001b[32m✓\u001b[0m ok')).toBe('✓ ok');
    expect(commandOf({ command: 'npm test' })).toBe('npm test');
    expect(commandOf({ command: ['git', 'status'] })).toBe('git status');
    expect(exitCodeOf({ exitCode: 2 })).toBe(2);
    expect(exitCodeOf('text')).toBeNull();
    expect(outputOf({ content: [{ type: 'content', content: { type: 'text', text: 'hi' } }] })).toBe('hi');
  });
});

describe('slash menu', () => {
  const cmds = [{ name: 'compact' }, { name: 'init', description: 'Write a CLAUDE.md' }, { name: 'security-review' }, { name: 'review' }];
  it('opens only for a lone /word', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/rev')).toBe('rev');
    expect(slashQuery('/review now')).toBeNull();
    expect(slashQuery('hello /x')).toBeNull();
  });
  it('lists prefix matches first, then other matches', () => {
    expect(matchCommands(cmds, 'rev').map((c) => c.name)).toEqual(['review', 'security-review']);
    expect(matchCommands(cmds, 'claude').map((c) => c.name)).toEqual(['init']);
    expect(matchCommands(cmds, '').length).toBe(4);
  });
});
