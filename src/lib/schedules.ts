// Plain-language view of the server's schedules and triggers (`_hearth/schedules`): cron in words, a title for every
// row, the group a row belongs to, and short relative times. Pure functions, so they are tested on their own.

export interface Schedule {
  id: number; project: string; cron: string; tz: string; kind: string; title: string; prompt: string;
  enabled: boolean; last_run_at: string | null; handler: string | null;
}
export interface Trigger {
  id: number; name: string; project: string; source: string; title: string; enabled: boolean;
  queued?: number; hookUrl?: string; every_sec?: number | null; config?: Record<string, unknown> | null; last_error?: string | null;
}
export interface Run { schedule_id?: number; trigger_id?: number; title?: string; name?: string; started_at: string; ended_at?: string | null; status?: string | null; session_id?: string | null }

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** A one-off: the server takes an ISO date-time instead of a cron pattern. */
export const isOneOff = (cron: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cron.trim());

/** The days part of a cron (day of month, month, weekday) in words, or null when it is not a common shape. */
function days(dom: string, mon: string, dow: string): string | null {
  if (mon !== '*') return null;
  if (dom !== '*' && dow !== '*') return null;
  if (dom !== '*') { const d = num(dom); return d ? `Monthly on the ${ordinal(d)}` : null; }
  if (dow === '*') return 'Every day';
  const norm = dow.replace(/\b7\b/g, '0');
  if (norm === '1-5') return 'Weekdays';
  if (norm === '0,6' || norm === '6,0') return 'Weekends';
  const range = norm.match(/^(\d)-(\d)$/);
  if (range) return `${DAY[Number(range[1])]} to ${DAY[Number(range[2])]}`;
  const ds = norm.split(',').map(num);
  if (ds.some((d) => d === null || d > 6)) return null;
  return list(ds.map((d) => `${DAY[d!]}s`));
}

/**
 * A cron pattern (or a one-off date) in words: "Weekdays at 07:15 and 18:15", "Every 15 minutes",
 * "Once, 31 Jan 2027 at 09:00". Null when the pattern is unusual; show the cron itself then.
 */
export function describeCron(cron: string): string | null {
  const c = cron.trim();
  if (isOneOff(c)) {
    const m = c.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)!;
    return `Once, ${Number(m[3])} ${MONTH[Number(m[2]) - 1]} ${m[1]} at ${m[4]}:${m[5]}`;
  }
  const f = c.split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  const allDays = dom === '*' && mon === '*' && dow === '*';
  // Every N minutes / hours.
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === '*' && allDays) return Number(everyMin[1]) === 1 ? 'Every minute' : `Every ${everyMin[1]} minutes`;
  if (min === '*' && hour === '*' && allDays) return 'Every minute';
  const everyHour = hour.match(/^\*\/(\d+)$/);
  const m0 = num(min);
  if (m0 !== null && (hour === '*' || everyHour)) {
    const d = days(dom, mon, dow);
    if (!d) return null;
    const step = everyHour ? Number(everyHour[1]) : 1;
    const base = step === 1 ? 'Every hour' : `Every ${step} hours`;
    return `${d === 'Every day' ? base : `${d}, ${base.toLowerCase()}`}${m0 ? ` at :${pad(m0)}` : ''}`;
  }
  // Fixed times: one minute with one or more hours, or several minutes in one hour.
  const mins = min.split(',').map(num), hours = hour.split(',').map(num);
  if (mins.some((x) => x === null || x > 59) || hours.some((x) => x === null || x > 23)) return null;
  if (mins.length > 1 && hours.length > 1) return null;
  const times = hours.flatMap((h) => mins.map((m) => hm(h!, m!)));
  const d = days(dom, mon, dow);
  return d ? `${d} at ${list(times)}` : null;
}

export type Group = 'assistant' | 'jobs' | 'reminders';
export const GROUPS: { id: Group; title: string; sub: string }[] = [
  { id: 'assistant', title: 'Assistant jobs', sub: 'Built into the server: the brief, email triage, meetings and check-ins.' },
  { id: 'jobs', title: 'Other jobs', sub: 'Your own timed jobs. Each run is a session in its project.' },
  { id: 'reminders', title: 'Reminders', sub: 'A fixed note to you at a time. No model runs.' },
];

/** Which group a schedule belongs to: reminders, the built-in (assistant) jobs, and everything else. */
export function groupOf(s: Pick<Schedule, 'handler' | 'project'>): Group {
  if (s.handler === 'reminder') return 'reminders';
  if (s.handler || /^assistant(-|$)/.test(s.project)) return 'assistant';
  return 'jobs';
}

const HANDLER_TITLE: Record<string, string> = {
  brief: 'Brief', triage: 'Email triage', meetings: "Tomorrow's meetings", review: 'Assistant review', checkin: 'Check-ins', reminder: 'Reminder',
};

/** A title for every row: its own (without a "Reminder:" prefix in the reminders group), else the job's name, else its prompt. */
export function displayTitle(s: Pick<Schedule, 'id' | 'title' | 'prompt' | 'handler'>): string {
  let t = (s.title ?? '').trim();
  if (s.handler === 'reminder') { t = t.replace(/^reminder\s*[:\-–]\s*/i, ''); t = t.charAt(0).toUpperCase() + t.slice(1); }
  if (t) return t;
  if (s.handler && HANDLER_TITLE[s.handler] && s.handler !== 'reminder') return HANDLER_TITLE[s.handler];
  const p = (s.prompt ?? '').replace(/^(job|reminder)\s*:\s*/i, '').trim().split(/(?<=[.!?])\s|\n/)[0]?.trim();
  if (p) return p.length > 60 ? `${p.slice(0, 57).trimEnd()}…` : p;
  return s.handler ? HANDLER_TITLE[s.handler] ?? `Schedule ${s.id}` : `Schedule ${s.id}`;
}

export type Status = 'on' | 'off' | 'done' | 'running' | 'failed';

/** A row's state at a glance. A one-off that has run and turned itself off is done, not off. */
export function statusOf(s: Pick<Schedule, 'cron' | 'enabled' | 'last_run_at'>, lastRun?: Run): Status {
  if (lastRun && !lastRun.ended_at && !lastRun.status) return 'running';
  if (isOneOff(s.cron) && !s.enabled && s.last_run_at) return 'done';
  if (!s.enabled) return 'off';
  if (lastRun?.status && /fail|error|cancel/i.test(lastRun.status)) return 'failed';
  return 'on';
}

/** A short local time near now (lib/dates.ts, shared by every screen). */
export { shortWhen } from './dates';

/** What a trigger listens to, in words. */
export function describeTrigger(t: Pick<Trigger, 'source' | 'every_sec' | 'config' | 'hookUrl'>): string {
  const cfg = (t.config ?? {}) as { tool?: string; events?: string[] };
  if (t.source === 'poll') {
    const mins = t.every_sec ? Math.max(1, Math.round(t.every_sec / 60)) : null;
    return `Checks ${cfg.tool ?? 'a tool'}${mins ? ` every ${mins === 1 ? 'minute' : `${mins} minutes`}` : ''}`;
  }
  if (t.source === 'event') return `On ${cfg.events?.length ? list(cfg.events.map((e) => e.replace(/_/g, ' '))) : 'server events'}`;
  if (t.source === 'webhook') return `Webhook${t.hookUrl ? ` at ${t.hookUrl}` : ''}`;
  return t.source;
}

/** True when a reminder's text only repeats its title (then the title is enough). */
export const sameText = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/^reminder\s*[:\-–]\s*/, '').replace(/[\s.!?…]+$/, '').trim();
  return n(a) === n(b);
};
