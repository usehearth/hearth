// Development only (`npm run dev`, then /#preview/schedules): the real Settings screen against made-up server data, so a
// screen can be looked at and screenshotted without a server. ?theme=dark or ?theme=light forces a theme; ?frame=390 shows a phone width.
import { useEffect } from 'react';
import { Settings } from '@/components/hearth/Settings';
import type { DirectoryState } from '@/lib/directory';
import { useTheme, setThemeMode } from '@/lib/theme';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00:00`;
const past = iso(new Date(Date.now() - 2 * 86_400_000)), soon = iso(new Date(Date.now() + 25 * 86_400_000)), later = iso(new Date(Date.now() + 77 * 86_400_000));

// Shaped like a real server's rows: built-in jobs with no prompt, your own jobs, one-offs, a reminder that has run.
const schedules = [
  { id: 9, project: 'work-comms', cron: '15 7,18 * * 1-5', tz: 'Europe/London', kind: 'job', title: 'Work digest: mail, chat, proposed tasks', prompt: 'Job: Work digest for the brief.', enabled: true, last_run_at: ago(20), handler: null },
  { id: 11, project: 'work-comms', cron: '0 16 * * 5', tz: 'Europe/London', kind: 'job', title: 'Style check (weekly, proposes updates)', prompt: 'Job: Style check.', enabled: true, last_run_at: ago(44), handler: null },
  { id: 16, project: 'assistant-triage', cron: '30 7,18 * * *', tz: 'Europe/London', kind: 'job', title: 'Brief (morning and evening)', prompt: '', enabled: true, last_run_at: ago(8), handler: 'brief' },
  { id: 17, project: 'assistant-triage', cron: '*/15 * * * *', tz: 'Europe/London', kind: 'job', title: '', prompt: '', enabled: true, last_run_at: ago(0.1), handler: 'triage' },
  { id: 18, project: 'assistant', cron: '30 8,16 * * 1-5', tz: 'Europe/London', kind: 'job', title: 'Check-ins (weekdays 08:30 and 16:30)', prompt: '', enabled: true, last_run_at: ago(47), handler: 'checkin' },
  { id: 21, project: 'home-network', cron: '10 8 * * 1', tz: 'Europe/London', kind: 'job', title: 'AI spend and quota (weekly)', prompt: 'Weekly read-only spend check.', enabled: true, last_run_at: ago(80), handler: null },
  { id: 22, project: 'home-network', cron: '0 9 1 * *', tz: 'Europe/London', kind: 'job', title: '', prompt: "Monthly read-only review of what is running on the home network. Read only.", enabled: true, last_run_at: null, handler: null },
  { id: 23, project: 'home-network', cron: later, tz: 'Europe/London', kind: 'job', title: 'Recheck a tool I trialled', prompt: 'See whether it has matured.', enabled: true, last_run_at: null, handler: null },
  { id: 24, project: 'home-network', cron: soon, tz: 'Europe/London', kind: 'job', title: 'Reminder: move backups off the old drive', prompt: 'The backups need to move before the old drive is retired.', enabled: true, last_run_at: null, handler: 'reminder' },
  { id: 26, project: 'home-network', cron: past, tz: 'Europe/London', kind: 'job', title: 'Reminder: rotate the test keys', prompt: 'Rotate the test keys.', enabled: false, last_run_at: ago(48), handler: 'reminder' },
  { id: 27, project: 'home-network', cron: '0 9 * * 1', tz: 'Europe/London', kind: 'job', title: 'Reminder: old cleanup still waiting', prompt: 'Old cleanup still waiting.', enabled: false, last_run_at: null, handler: 'reminder' },
  { id: 29, project: 'assistant-triage', cron: '0 17 * * 0-4', tz: 'Europe/London', kind: 'job', title: "Tomorrow's meetings (effort per meeting)", prompt: '', enabled: true, last_run_at: null, handler: 'meetings' },
];
const next = [
  { id: 9, next: ahead(14) }, { id: 11, next: ahead(120) }, { id: 16, next: ahead(2) }, { id: 17, next: ahead(0.2) }, { id: 18, next: ahead(17) },
  { id: 21, next: ahead(16) }, { id: 22, next: ahead(380) }, { id: 23, next: null }, { id: 24, next: null }, { id: 29, next: ahead(1) },
];
const runs = { schedules: [
  { schedule_id: 17, title: 'Email triage', started_at: ago(0.1), ended_at: null, status: null },
  { schedule_id: 16, title: 'Brief (morning and evening)', started_at: ago(8), ended_at: ago(7.9), status: 'ended' },
  { schedule_id: 9, title: 'Work digest: mail, chat, proposed tasks', started_at: ago(20), ended_at: ago(19.9), status: 'ended' },
  { schedule_id: 11, title: 'Style check (weekly, proposes updates)', started_at: ago(44), ended_at: ago(43.8), status: 'failed' },
], triggers: [] };

// Extensions and Claude Code's own config as the work runner reports it (one item held back: it names a client).
const extensions = [
  { id: 'e1', kind: 'command', name: 'standup', scope: 'global', description: 'Three lines on yesterday, today and blockers', enabled: true, source: 'owner' },
  { id: 'e2', kind: 'skill', name: 'release-notes', scope: 'todo-api', description: 'Write release notes from merged PRs', enabled: true, source: 'claude-code:skills' },
];
// Shaped like a real ~/.claude: your own items (source "user"), then plugins ("plugin:<name>"), some of them big.
const ccItem = (source: string, kind: string, name: string, description: string | null, extra: object = {}) =>
  ({ key: `${source}/${kind}/${name}`, source, kind, name, description, bytes: 1200, files: 0, importable: true, ...extra });
const ccItems = [
  ...['scout', 'grunt', 'reviewer', 'test-runner', 'test-writer', 'docs-writer'].map((n) => ccItem('user', 'agent', n, `The ${n} subagent`)),
  ...['code-walkthrough', 'graphify', 'home-infra', 'hf-cli'].map((n) => ccItem('user', 'skill', n, `Your ${n} skill`)),
  ccItem('user', 'command', 'tars', 'Set TARS personality dials'),
  ccItem('user', 'hook', 'state-reminder', 'Asks for a STATE.md update after work changes'),
  ccItem('user', 'skill', 'acme-deploy', null, { importable: false, held: ['names-a-client'] }),
  ...Array.from({ length: 35 }, (_, i) => ccItem('plugin:claude-seo', 'skill', `seo-${i + 1}`, 'An SEO analysis skill')),
  ...Array.from({ length: 22 }, (_, i) => ccItem('plugin:claude-seo', 'agent', `seo-agent-${i + 1}`, 'An SEO subagent')),
  ...Array.from({ length: 12 }, (_, i) => ccItem('plugin:ponytail', 'skill', `ponytail-${i + 1}`, 'Lazy senior dev mode')),
  ...Array.from({ length: 13 }, (_, i) => ccItem('plugin:umbraco-mcp-skills', 'skill', `umbraco-${i + 1}`, 'Umbraco MCP skill')),
];
const providers = [
  { name: 'meridian', kind: 'anthropic', base_url: 'http://192.0.2.10:3456', has_key: true, models: { default: 'claude-sonnet-5-5', strong: 'claude-opus-5-5', fast: 'claude-haiku-5-5' }, priority: 10, enabled: true, sensitive_ok: true, status: 'ok', last_ok: ago(0.1), last_error: null },
  { name: 'cliproxy', kind: 'openai', base_url: 'http://192.0.2.10:8317/v1', has_key: true, models: { default: 'gemini-3.5-flash' }, priority: 20, enabled: true, sensitive_ok: false, status: 'down', last_ok: ago(3), last_error: 'HTTP 429, model cooldown: You exceeded your current quota, please check your plan.' },
];

const request = async <T,>(method: string, params?: { source?: string; install?: boolean; picks?: unknown[] }): Promise<T> => {
  await new Promise((r) => setTimeout(r, 150));
  if (method === '_hearth/schedules') return { schedules, next, triggers: [], runs } as T;
  if (method === '_hearth/extensions') return { extensions } as T;
  if (method === '_hearth/extensions/import' && params?.source === 'claude-code') return (params.install ? { saved: (params.picks ?? []).map(String), skipped: [] } : { items: ccItems }) as T;
  if (method === '_hearth/providers') return { providers, canEdit: true } as T;
  return {} as T;
};

const dir: DirectoryState = {
  state: 'ready', agent: 'Monolith', groups: [
    { project: 'cbg-uk-valsparpaint', name: 'CBG-UK-ValsparPaint', cwd: 'C:/p/valspar', threads: [], client: 'Enjoy' },
    { project: 'historic-scotland', name: 'historic-scotland', cwd: 'C:/p/hs', threads: [], client: 'Storm' },
    { project: 'compdev-platform', name: 'compdev-platform', cwd: 'C:/p/compdev', threads: [] },
  ], refresh: () => {}, cards: [], answer: async () => {}, extensions: ['schedules', 'usage', 'audit', 'extensions', 'providers'],
  clients: [], workDevice: false, admin: true, importedGroups: [], request: request as never,
};

export default function Preview() {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  // ?frame=390: the same page in a 390px frame, so phone layouts can be screenshotted where windows can't be that narrow.
  const frame = Number(params.get('frame'));
  if (frame) {
    params.delete('frame');
    return <iframe title="Phone preview" src={`/?${params}${location.hash}`} style={{ width: frame, height: '100vh', border: 0, display: 'block' }} />;
  }
  useEffect(() => { if (theme === 'dark' || theme === 'light') setThemeMode(theme); }, [theme]);
  useTheme();
  useEffect(() => {
    // Open the section named in the hash (#preview/schedules).
    const want = location.hash.split('/')[1];
    const t = setTimeout(() => document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button')
      .forEach((b) => { if (b.textContent?.toLowerCase().startsWith(want)) b.click(); }), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="h-full">
      <Settings servers={[{ id: 'dev', name: 'Dev server', url: 'wss://dev.example' } as never]} server={undefined} dir={dir} onAdd={() => {}} onUse={() => {}} onKeyChanged={() => {}} />
    </div>
  );
}
