import { describe, expect, it } from 'vitest';
import { permissionView, riskOf } from './permission';

const card = (title: string, rawInput: unknown, why = 'A running pm agent in site is waiting for your OK to run this.', kind = 'execute') =>
  ({ title, why, toolCall: { title: title.replace(/^Allow: /, ''), kind, rawInput } });

describe('permission cards in words', () => {
  it('drops backticks, keeps the exact command and shows the agent\'s reason instead of the old internal line', () => {
    const v = permissionView(card('Allow: `git push origin main`', { command: 'git push origin main', description: 'Push the release to GitHub' }));
    expect(v).toEqual({ title: 'Allow: git push origin main', command: 'git push origin main', reason: 'Push the release to GitHub', why: null, risk: null });
  });
  it('shows the reason once when the server already sends it as the line', () => {
    const v = permissionView(card('Allow: git push origin main', { command: 'git push origin main', description: 'Push the release to GitHub' }, 'Push the release to GitHub.'));
    expect(v.reason).toBe('Push the release to GitHub');
    expect(v.why).toBeNull();
  });
  it('keeps a server line that says something new', () => {
    const v = permissionView(card('Allow: Write notes.md', { file_path: 'notes.md' }, 'The agent in Website wants to write outside its folder.', 'edit'));
    expect(v.why).toBe('The agent in Website wants to write outside its folder.');
    expect(v.command).toBe('Write notes.md');
    expect(v.reason).toBeNull();
  });
  it('falls back to the call title when there is no command input', () => {
    expect(permissionView({ title: 'Allow: `ls`', why: '', toolCall: { title: '`ls -la`' } }).command).toBe('ls -la');
    expect(permissionView({ title: 'Allow: x', why: '', toolCall: null }).command).toBeNull();
  });
});

describe('destructive commands', () => {
  it.each([
    ['rm -rf dist/ .cache/', 'Deletes files'],
    ['Remove-Item -Recurse -Force .\build', 'Deletes files'],
    ['del /s /q build', 'Deletes files'],
    ['git push --force origin main', 'Overwrites history on the remote'],
    ['git push -f', 'Overwrites history on the remote'],
    ['git reset --hard HEAD~3', 'Throws away changes'],
    ['psql -c "DROP TABLE users"', 'Deletes data'],
    ['docker system prune -a', 'Deletes containers or their data'],
    ['sudo reboot', 'Restarts or shuts down the machine'],
  ])('%s', (cmd, risk) => expect(riskOf(cmd)).toBe(risk));
  it('leaves ordinary commands alone', () => {
    for (const cmd of ['git push origin main', 'npm test', 'ls -la', 'git status', 'cat README.md', 'npm run format']) expect(riskOf(cmd)).toBeNull();
  });
  it('treats an ACP delete call as a risk', () => expect(riskOf(null, 'delete')).toBe('Deletes files'));
});
