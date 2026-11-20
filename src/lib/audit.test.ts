import { describe, expect, it } from 'vitest';
import { auditDetail, auditLine, auditWho } from './audit';

describe('the audit log in words', () => {
  it('names who did it', () => {
    expect(auditWho('device:zed-laptop')).toBe('zed-laptop');
    expect(auditWho('core')).toBe('The server');
    expect(auditWho('zed')).toBe('zed');
  });
  it('says what happened, with the target when it is a name and the project when there is one', () => {
    expect(auditLine({ actor: 'device:zed-laptop', action: 'mcp_server.update', target: 'calendar', detail: { client: null } })).toBe('zed-laptop changed connector calendar');
    expect(auditLine({ actor: 'core', action: 'provider.create', target: 'backup', detail: { kind: 'openai' } })).toBe('The server added model provider backup');
    expect(auditLine({ actor: 'device:zed-laptop', action: 'chat.create', target: 'be3faeeb-1321-4873-a099-c6c6e40c72d6', detail: { agent: 'claude-code', project: 'site' } }))
      .toBe('zed-laptop started a thread in site');
    expect(auditLine({ actor: 'device:zed-laptop', action: 'project.upsert', target: 'home-2', detail: { project: 'home-2' } })).toBe('zed-laptop saved project home-2');
  });
  it('uses project names when it knows them', () => {
    const names = { site: 'Website', 'home-2': 'Home (2)' };
    expect(auditLine({ actor: 'device:zed-laptop', action: 'chat.create', target: 'be3faeeb-1321-4873-a099-c6c6e40c72d6', detail: { project: 'site' } }, names)).toBe('zed-laptop started a thread in Website');
    expect(auditLine({ actor: 'device:zed-laptop', action: 'project.upsert', target: 'home-2', detail: { project: 'home-2' } }, names)).toBe('zed-laptop saved project Home (2)');
  });
  it('drops an unreadable target from a phrase that names one', () => {
    expect(auditLine({ actor: 'device:x', action: 'device.revoke', target: '12', detail: null })).toBe('x revoked the device key');
    expect(auditLine({ actor: 'device:x', action: 'mcp_server.delete', target: null, detail: null })).toBe('x removed a connector');
  });
  it('keeps the raw action when it has no words yet', () => {
    expect(auditLine({ actor: 'device:zed-laptop', action: 'pool.update', target: 'work', detail: null })).toBe('zed-laptop: pool.update work');
  });
  it('keeps the raw entry for the details line', () => {
    expect(auditDetail({ action: 'import.finish', target: '2', detail: { left: 11, uploaded: 0 } })).toBe('import.finish · 2 · left: 11 · uploaded: 0');
  });
});
