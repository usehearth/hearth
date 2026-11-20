import { describe, expect, it } from 'vitest';
import { clockTime, dayDate, fullWhen, shortWhen } from './dates';

const now = new Date(2026, 10, 19, 18, 30);
const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo, d, h, mi).toISOString();

describe('times in the guide format', () => {
  it('is short and relative near now, 24-hour', () => {
    expect(shortWhen(at(2026, 10, 19, 18, 15), now)).toBe('today 18:15');
    expect(shortWhen(at(2026, 10, 18, 6, 5), now)).toBe('yesterday 06:05');
    expect(shortWhen(at(2026, 10, 20, 7, 30), now)).toBe('tomorrow 07:30');
    expect(shortWhen(at(2026, 10, 16, 16, 30), now)).toBe('Mon 16:30');
  });
  it('gives a date further out, with the year only when it differs', () => {
    expect(shortWhen(at(2026, 8, 1), now)).toBe('1 Sep');
    expect(shortWhen(at(2027, 0, 31), now)).toBe('31 Jan 2027');
    expect(dayDate(at(2026, 8, 1), now, true)).toBe('1 Sep 2026');
  });
  it('spells out the full date and time for tooltips', () => {
    expect(fullWhen(at(2026, 10, 19, 18, 15))).toBe('Thursday 19 November 2026, 18:15');
    expect(clockTime(new Date(2026, 10, 19, 7, 4, 9).toISOString())).toBe('07:04:09');
  });
  it('is empty for nothing or nonsense', () => {
    expect(shortWhen(null, now)).toBeNull();
    expect(shortWhen('not a date', now)).toBeNull();
    expect(fullWhen(undefined)).toBeUndefined();
  });
});
