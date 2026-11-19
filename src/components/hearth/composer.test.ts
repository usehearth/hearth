import { describe, expect, it } from 'vitest';
import { modelLabel } from './ComposerBar';

const engine = { currentValue: 'claude-sonnet-5-5', options: [{ value: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }, { value: 'claude-opus-5-5', name: 'Opus 5.5' }] };

describe('the model pill', () => {
  it('names the model in use first', () => {
    expect(modelLabel({ engineModel: engine })).toBe('Sonnet 5.5');
    expect(modelLabel({ engineModel: { ...engine, currentValue: 'claude-opus-5-5' } })).toBe('Opus 5.5');
    expect(modelLabel({ engineModel: { currentValue: 'x-unknown', options: [] } })).toBe('x-unknown');
  });
  it('adds the provider when one is picked, so a change of provider shows', () => {
    expect(modelLabel({ engineModel: engine, chosen: 'primary' })).toBe('Sonnet 5.5 · primary');
  });
  it('names a model picked by name, else the provider, else Auto', () => {
    expect(modelLabel({ chosenModel: 'gem-strong', chosen: 'backup', engineModel: engine })).toBe('gem-strong');
    expect(modelLabel({ chosen: 'backup' })).toBe('backup');
    expect(modelLabel({})).toBe('Auto');
  });
});
