// Times the way the guide says (docs/ux-and-brand.md, "Times"): short and relative near now ("today 18:15",
// "yesterday 09:02", "Fri 16:30"), a date further out ("31 Jan 2027"), always the 24-hour clock, and the full date and
// time in the tooltip. One place for every screen, so none falls back to the browser's own format ("11/19/2026, 6:00 PM").

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const two = (n: number) => String(n).padStart(2, '0');
/** "07:05" */
export const hm = (h: number, m: number) => `${two(h)}:${two(m)}`;
const parse = (iso: string | null | undefined) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A short local time near now: "today 18:15", "tomorrow 07:30", "yesterday 09:02", "Mon 08:30", "31 Jan 2027". */
export function shortWhen(iso: string | null | undefined, now: Date = new Date()): string | null {
  const d = parse(iso);
  if (!d) return null;
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const t = hm(d.getHours(), d.getMinutes());
  if (days === 0) return `today ${t}`;
  if (days === 1) return `tomorrow ${t}`;
  if (days === -1) return `yesterday ${t}`;
  if (Math.abs(days) < 7) return `${DAY_SHORT[d.getDay()]} ${t}`;
  return dayDate(iso, now);
}

/** A day without a time: "1 Sep", or "1 Sep 2025" in another year (or always, with `withYear`). */
export function dayDate(iso: string | null | undefined, now: Date = new Date(), withYear = false): string | null {
  const d = parse(iso);
  if (!d) return null;
  return `${d.getDate()} ${MONTH[d.getMonth()]}${withYear || d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** The full date and time, for a tooltip: "Thursday 19 November 2026, 18:15". */
export function fullWhen(iso: string | null | undefined): string | undefined {
  const d = parse(iso);
  if (!d) return undefined;
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}, ${hm(d.getHours(), d.getMinutes())}`;
}

/** A clock time only, for a timeline within a day: "18:15:04". */
export function clockTime(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? `${hm(d.getHours(), d.getMinutes())}:${two(d.getSeconds())}` : null;
}
