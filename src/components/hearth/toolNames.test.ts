import { describe, expect, it } from 'vitest';
import { readableToolName } from './toolNames';

describe('readable tool names', () => {
  it('turns MCP tool names into "server: tool" (names from the 19 Nov runs)', () => {
    expect(readableToolName('mcp__browser__browser_navigate')).toBe('browser: navigate');
    expect(readableToolName('mcp__browser__browser_take_screenshot')).toBe('browser: take screenshot');
    expect(readableToolName('mcp__kb__search')).toBe('kb: search');
    expect(readableToolName('mcp__mono__hand_off')).toBe('mono: hand off');
  });
  it('keeps the innermost server when a proxy wraps the tool', () => {
    expect(readableToolName('mcp__oc__mcp__tides__get_tide')).toBe('tides: get tide');
  });
  it('says a repeated server name once (MCPHub tools)', () => {
    expect(readableToolName('mcp__mcphub__taiga-taiga_issues_list')).toBe('mcphub: taiga issues list');
  });
  it('leaves other tools, and anything after the name, as they were', () => {
    expect(readableToolName('Read src/app.js')).toBe('Read src/app.js');
    expect(readableToolName('npm test')).toBe('npm test');
    expect(readableToolName('mcp__browser__browser_click (Show prices)')).toBe('browser: click (Show prices)');
    expect(readableToolName('mcp__weird')).toBe('mcp__weird');
  });
});
