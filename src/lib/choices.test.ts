import { describe, expect, it } from 'vitest';
import { clientNames, projectChoices } from './choices';

describe('choices for forms', () => {
  it('lists each client once, from projects and from client summary lines, sorted', () => {
    expect(clientNames([{ client: 'Globex' }, { client: null }, { client: 'Acme' }, { client: 'acme ' }, {}], [{ client: 'Initech' }, { client: 'Globex' }]))
      .toEqual(['Acme', 'Globex', 'Initech']);
    expect(clientNames([])).toEqual([]);
  });
  it('lists projects once each, by name', () => {
    expect(projectChoices([{ slug: 'site', name: 'Website' }, { slug: 'acme-shop', name: 'Acme shop' }, { slug: 'site', name: 'Website' }]).map((p) => p.slug))
      .toEqual(['acme-shop', 'site']);
  });
});
