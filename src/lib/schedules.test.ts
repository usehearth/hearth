import { describe, expect, it } from 'vitest';
import { describeCron, describeTrigger, displayTitle, groupOf, shortWhen, statusOf } from './schedules';

describe('describeCron', () => {
  it.each([
    ['15 7,18 * * 1-5', 'Weekdays at 07:15 and 18:15'],
    ['30 7,18 * * *', 'Every day at 07:30 and 18:30'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 16 * * 5', 'Fridays at 16:00'],
    ['0 17 * * 0-4', 'Sunday to Thursday at 17:00'],
    ['0 9 1 * *', 'Monthly on the 1st at 09:00'],
    ['0 9 22 * *', 'Monthly on the 22nd at 09:00'],
    ['10 8 * * 1', 'Mondays at 08:10'],
    ['0 9 * * 1,3,5', 'Mondays, Wednesdays and Fridays at 09:00'],
    ['0 10 * * 0,6', 'Weekends at 10:00'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['5 * * * 1-5', 'Weekdays, every hour at :05'],
    ['2027-01-31T09:00:00', 'Once, 31 Jan 2027 at 09:00'],
  ])('%s → %s', (cron, words) => expect(describeCron(cron)).toBe(words));

  it('gives up on unusual patterns', () => {
    expect(describeCron('0 9 * 3 *')).toBeNull();
    expect(describeCron('0-30/5 9 * * *')).toBeNull();
    expect(describeCron('nonsense')).toBeNull();
  });
});

describe('groups and titles', () => {
  it('sorts rows into assistant jobs, other jobs and reminders', () => {
    expect(groupOf({ handler: 'brief', project: 'assistant-triage' })).toBe('assistant');
    expect(groupOf({ handler: null, project: 'assistant' })).toBe('assistant');
    expect(groupOf({ handler: null, project: 'client-comms' })).toBe('jobs');
    expect(groupOf({ handler: 'reminder', project: 'network-ai-audit' })).toBe('reminders');
  });
  it('always has a title', () => {
    expect(displayTitle({ id: 1, title: 'Reminder: rotate leaked secrets', prompt: '', handler: 'reminder' })).toBe('Rotate leaked secrets');
    expect(displayTitle({ id: 2, title: '', prompt: '', handler: 'triage' })).toBe('Email triage');
    expect(displayTitle({ id: 3, title: '  ', prompt: 'Job: Look at the inbox. Then write.', handler: null })).toBe('Look at the inbox.');
    expect(displayTitle({ id: 4, title: '', prompt: '', handler: null })).toBe('Schedule 4');
  });
});

describe('status', () => {
  it('marks a one-off that has run as done', () => {
    expect(statusOf({ cron: '2026-11-13T09:00:00', enabled: false, last_run_at: '2026-11-13T09:00:00Z' })).toBe('done');
    expect(statusOf({ cron: '0 9 * * 1', enabled: false, last_run_at: null })).toBe('off');
    expect(statusOf({ cron: '0 9 * * 1', enabled: true, last_run_at: null })).toBe('on');
    expect(statusOf({ cron: '0 9 * * 1', enabled: true, last_run_at: null }, { started_at: 'x', status: null, ended_at: null })).toBe('running');
    expect(statusOf({ cron: '0 9 * * 1', enabled: true, last_run_at: null }, { started_at: 'x', status: 'failed', ended_at: 'y' })).toBe('failed');
  });
});

describe('shortWhen', () => {
  const now = new Date(2026, 10, 15, 12, 0); // Sun 15 Nov 2026, local time
  it('says today, tomorrow, a weekday or a date', () => {
    expect(shortWhen(new Date(2026, 10, 15, 18, 15).toISOString(), now)).toBe('today 18:15');
    expect(shortWhen(new Date(2026, 10, 16, 7, 30).toISOString(), now)).toBe('tomorrow 07:30');
    expect(shortWhen(new Date(2026, 10, 13, 16, 30).toISOString(), now)).toBe('Fri 16:30');
    expect(shortWhen(new Date(2027, 0, 31, 9, 0).toISOString(), now)).toBe('31 Jan 2027');
    expect(shortWhen(null, now)).toBeNull();
  });
});

describe('describeTrigger', () => {
  it('says what a trigger listens to', () => {
    expect(describeTrigger({ source: 'poll', every_sec: 300, config: { tool: 'search_gmail_messages' } })).toBe('Checks search_gmail_messages every 5 minutes');
    expect(describeTrigger({ source: 'event', config: { events: ['task_failed', 'task_needs_you'] } })).toBe('On task failed and task needs you');
    expect(describeTrigger({ source: 'webhook', hookUrl: '/hook/trigger/gh' })).toBe('Webhook at /hook/trigger/gh');
  });
});
