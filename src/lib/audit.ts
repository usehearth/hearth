// The audit log in words: "zed-laptop changed connector calendar" rather than "mcp_server.update · device:zed-laptop ·
// calendar · client: null". The raw entry stays one click away (the row's details).

export interface AuditEntry { id: string; at: string; actor: string; action: string; target: string | null; detail: Record<string, unknown> | null }

/** Who did it: "device:zed-laptop" -> "zed-laptop", "core" -> "The server", a login name as it is. */
export function auditWho(actor: string): string {
  if (actor === 'core' || actor === 'system') return 'The server';
  if (actor.startsWith('device:')) return actor.slice('device:'.length) || 'A device';
  if (actor === 'automation') return 'A scheduled job';
  return actor;
}

// What happened, as a verb phrase; `{t}` is the target's name when it reads well (a project, connector, provider...).
const WORDS: Record<string, string> = {
  'chat.create': 'started a thread', 'chat.rename': 'renamed a thread', 'chat.delete': 'deleted a thread', 'chat.archive': 'archived a thread',
  'chat.unarchive': 'brought back an archived thread', 'chat.pin': 'pinned a thread', 'chat.fork': 'branched a thread', 'chat.mode': 'changed a thread\'s mode',
  'chat.provider': 'changed a thread\'s model provider', 'chat.setting': 'changed a thread setting', 'chat.shell': 'ran a shell command in a thread',
  'project.upsert': 'saved project {t}', 'project.create': 'made project {t}', 'project.update': 'changed project {t}',
  'provider.create': 'added model provider {t}', 'provider.update': 'changed model provider {t}', 'provider.delete': 'removed model provider {t}',
  'mcp_server.create': 'added connector {t}', 'mcp_server.update': 'changed connector {t}', 'mcp_server.delete': 'removed connector {t}',
  'mcp_server.oauth_start': 'started signing in to connector {t}', 'mcp_server.oauth_connected': 'signed in to connector {t}',
  'mcp.provision_direct': 'set up the tools of project {t}', 'mcphub.provision': 'set up the tools of project {t}', 'mcphub.provision_failed': 'couldn\'t set up the tools of project {t}',
  'extension.save': 'saved extension {t}', 'extension.delete': 'removed extension {t}',
  'schedule.create': 'added a scheduled job', 'schedule.delete': 'removed a scheduled job', 'schedule.run_now': 'ran a scheduled job now', 'schedule.fire': 'ran a scheduled job',
  'trigger.create': 'added a trigger', 'trigger.update': 'changed a trigger', 'trigger.fire': 'fired a trigger', 'trigger.run_now': 'ran a trigger now',
  'channel.create': 'added channel {t}', 'channel.update': 'changed channel {t}', 'channel.delete': 'removed channel {t}', 'channel.test': 'tested channel {t}',
  'device.create': 'made a device key for {t}', 'device.revoke': 'revoked the device key of {t}', 'device.flags': 'changed the ticks of device {t}',
  'device.auth_failed': 'refused a device key that didn\'t match', 'login.failed': 'refused a sign-in', 'runner.auth_failed': 'refused a runner that didn\'t match',
  'passkey.added': 'added a passkey', 'passkey.removed': 'removed a passkey',
  'import.begin': 'started an import of Claude history', 'import.finish': 'finished an import of Claude history', 'import.memories': 'imported claude.ai memories',
  'permission.always': 'allowed something always', 'rule.add': 'added a standing rule', 'rule.revoke': 'removed a standing rule',
  'git.push': 'pushed a branch', 'git.pr': 'opened a pull request', 'task.create': 'started a task', 'task.cancel': 'cancelled a task',
  'budget.warning': 'warned that a project is near its budget', 'upload.save': 'saved an upload', 'retention.run': 'cleared out old data',
  'admin.thread_open': 'opened an admin thread', 'admin.thread_finish': 'finished an admin thread',
};

/** Whether a target is a name worth showing (not a UUID or a number). */
const readable = (t: string | null) => !!t && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t) && !/^\d+$/.test(t);

/** One line for an entry: "zed-laptop changed connector calendar", or the raw action when there are no words for it. */
export function auditLine(e: Pick<AuditEntry, 'actor' | 'action' | 'target' | 'detail'>, names: Record<string, string> = {}): string {
  const who = auditWho(e.actor);
  const words = WORDS[e.action];
  // Project slugs read as the project's name when this device knows it ("site" -> "Website").
  const name = (slug: string) => names[slug] ?? slug;
  const project = typeof e.detail?.project === 'string' ? name(e.detail.project) : null;
  if (!words) return `${who}: ${e.action}${readable(e.target) ? ` ${e.target}` : ''}`;
  // Without a readable name: "revoked the device key of {t}" -> "revoked the device key", "changed connector {t}" -> "changed a connector".
  const unnamed = (w: string) => w.replace(/ (of|for) \{t\}$/, '').replace(/ (connector|project|model provider|channel|extension) \{t\}$/, ' a $1').replace(' {t}', '');
  const what = words.includes('{t}') ? (readable(e.target) ? words.replace('{t}', /project \{t\}/.test(words) ? name(e.target!) : e.target!) : unnamed(words)) : words;
  return `${who} ${what}${project && !what.includes(project) ? ` in ${project}` : ''}`;
}

/** The raw entry for the details line: the action code, the target and each detail as key: value. */
export function auditDetail(e: Pick<AuditEntry, 'action' | 'target' | 'detail'>): string {
  const parts = [e.action, ...(e.target ? [e.target] : [])];
  for (const [k, v] of Object.entries(e.detail ?? {})) parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.join(' · ');
}
