import { describe, expect, it } from 'vitest';
import { cardPlan, planOf } from './hearth';

const PLAN = '## Plan\n\n1. Read the checkout flow.\n2. Add a wrapper.\n';
// What Claude Code's ACP adapter sends for ExitPlanMode to a client without the plan-file capability.
const exitPlan = { tool: 'ExitPlanMode', kind: 'switch_mode', content: [{ type: 'content', content: { type: 'text', text: PLAN } }] };

describe('the plan an agent asks you to approve', () => {
  it('reads it from the call input', () => {
    expect(planOf({ kind: 'switch_mode' }, { plan: PLAN })).toBe(PLAN.trim());
  });
  it('reads it from the text content of an ExitPlanMode call when the input has none', () => {
    expect(planOf(exitPlan, {})).toBe(PLAN.trim());
  });
  it('is null for other calls, EnterPlanMode included', () => {
    expect(planOf({ tool: 'Bash', kind: 'execute', content: [{ type: 'content', content: { type: 'text', text: 'ok' } }] }, { command: 'ls' })).toBeNull();
    expect(planOf({ tool: 'EnterPlanMode', kind: 'switch_mode', content: [] }, {})).toBeNull();
    expect(planOf(undefined, undefined)).toBeNull();
    expect(planOf({ tool: 'ExitPlanMode' }, { plan: '   ' })).toBeNull();
  });
  it('finds it on a permission card, with or without the engine tool name', () => {
    const toolCall = { title: 'Ready to code?', kind: 'switch_mode', rawInput: { plan: PLAN }, content: exitPlan.content };
    expect(cardPlan({ kind: 'permission', toolCall })).toBe(PLAN.trim());
    expect(cardPlan({ kind: 'permission', toolCall: { ...toolCall, rawInput: {} } })).toBe(PLAN.trim());
    expect(cardPlan({ kind: 'permission', toolCall: { title: '`git push`', kind: 'execute', rawInput: { command: 'git push' } } })).toBeNull();
    expect(cardPlan({ kind: 'question', toolCall })).toBeNull();
  });
});
