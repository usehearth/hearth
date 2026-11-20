import { describe, expect, it } from 'vitest';
import { commandOf, diffRows, diffStats, exitCodeOf, imagesOf, outputOf, shownResult, stripAnsi } from './ToolViews';
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

import { threadMarkdown } from './ExportThread';
describe('export', () => {
  it('writes the thread as Markdown, with tool calls and diffs', () => {
    const md = threadMarkdown('Greet', [
      { role: 'user', content: [{ type: 'text', text: 'add a flag' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'edit', providerMetadata: { acp: { title: 'Edit a.ts', content: [{ type: 'diff', path: 'a.ts', oldText: 'one\n', newText: 'two\n' }] } } }, { type: 'text', text: 'Done.' }] },
      { role: 'assistant', content: [{ type: 'data', name: 'hearth-notice', data: { text: 'primary is overloaded, so your message went to the next model provider.' } }] },
    ]);
    expect(md).toContain('# Greet');
    expect(md).toContain('## You');
    expect(md).toContain('- **Edit a.ts**');
    expect(md).toContain('-one');
    expect(md).toContain('+two');
    expect(md).toContain('Done.');
    // A server notice stays in the export, set apart from the agent's words.
    expect(md).toContain('_primary is overloaded, so your message went to the next model provider._');
  });
});

describe('pictures from tools', () => {
  // As the real run had them (19 Nov): Claude Code's Read of a PNG, and a browser screenshot (text plus image).
  const png = 'iVBORw0KGgoAAAANSUhEUg';
  const readPng = { content: [{ type: 'content', content: { type: 'image', data: png, mimeType: 'image/png' } }] };
  const rawRead = [{ type: 'image', source: { data: png, type: 'base64', media_type: 'image/png' } }];
  const screenshot = { content: [{ type: 'content', content: [{ type: 'text', text: '### Result\n- [Screenshot of viewport](page.png)' }, { type: 'image', data: png, mimeType: 'image/png' }] }] };

  it('finds the image a tool returned, as a data URL', () => {
    expect(imagesOf(readPng)).toEqual([`data:image/png;base64,${png}`]);
    expect(imagesOf(screenshot)).toEqual([`data:image/png;base64,${png}`]);
  });
  it('ignores calls without pictures and types it should not draw', () => {
    expect(imagesOf({ content: [{ type: 'content', content: { type: 'text', text: 'hi' } }] })).toEqual([]);
    expect(imagesOf({ content: [{ type: 'content', content: { type: 'image', data: png, mimeType: 'image/svg+xml' } }] })).toEqual([]);
    expect(imagesOf(undefined)).toEqual([]);
  });
  it('never shows the base64 of a picture as the result text', () => {
    expect(shownResult(readPng, rawRead)).toBeUndefined();
    expect(String(shownResult(screenshot, [{ text: 'x' }]))).toContain('Screenshot of viewport');
    expect(String(shownResult(screenshot, [{ text: 'x' }]))).not.toContain(png);
  });
  it('leaves other results as they were', () => {
    expect(shownResult({ content: [] }, 'plain output')).toBe('plain output');
  });
});
