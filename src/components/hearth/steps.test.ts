import { describe, expect, it } from 'vitest';
import { turnSteps } from './ThreadPane';

describe('the steps list under a reply', () => {
  const last = [{ content: 'Read greet.ts' }, { content: 'Run the tests' }];
  it('hides the steps from before this turn started', () => {
    expect(turnSteps(last, last)).toBeUndefined();
  });
  it('shows this turn\'s own steps as soon as they arrive', () => {
    const now = [{ content: 'Write the essay' }];
    expect(turnSteps(now, last)).toBe(now);
  });
  it('shows the steps when no turn has started in this window (a thread just opened)', () => {
    expect(turnSteps(last, undefined)).toBe(last);
    expect(turnSteps(undefined, last)).toBeUndefined();
  });
});
