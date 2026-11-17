// Development only (`npm run dev`, then /#preview/setup): the real first-run setup against a made-up provider and
// server, so the screens and the guide's loop can be looked at without a key, a server or the desktop shell.
// ?reset starts setup from the first screen. Made-up behaviour: the key "bad" is refused; addresses with "localhost"
// answer, others are refused; the device key "bad" is refused; the guide checks something, then answers.
import { useEffect } from 'react';
import { Setup, previewShell } from '@/components/hearth/Setup';
import { startSetup, setupState } from '@/lib/setup';
import { setThemeMode, useTheme } from '@/lib/theme';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

previewShell({
  check: async (_kind, _base, key) => { await wait(400); if (key === 'bad') throw 'That key was refused.'; return { models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] }; },
  status: async () => ({ kind: 'anthropic', base_url: 'https://api.anthropic.com', has_key: true }),
  forget: async () => {},
  docker: async () => { await wait(300); return { installed: true, running: false, version: '28.1.1', detail: 'cannot connect to the Docker daemon' }; },
  address: async (url) => { await wait(400); return url.includes('localhost') ? { tried: url, result: 'ok', status: 200 } : { tried: url, result: 'refused', detail: 'connection refused' }; },
  server: (async (_url: string, key: string, method?: string) => {
    await wait(400);
    if (key === 'bad') throw new Error('closed');
    return { agent: 'Hearth Server', extensions: ['providers'], ...(method ? { result: { providers: [{ name: 'anthropic', kind: 'anthropic', enabled: true, status: 'ok', last_error: null }] } } : {}) };
  }) as never,
  // A made-up model in Anthropic's format: a tool call first (with reply buttons), then an answer that uses the result.
  call: async (body: any) => {
    await wait(700);
    const last = body.messages.at(-1);
    if (typeof last.content === 'string') {
      return { stop_reason: 'tool_use', usage: { input_tokens: 1800, output_tokens: 60 }, content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 't1', name: 'setup_state', input: {} },
        { type: 'tool_use', id: 't2', name: 'suggest_replies', input: { replies: ['How do I install Docker?', 'What is a device key?'] } },
      ] };
    }
    const state = JSON.parse(last.content[0].content);
    return { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 90 }, content: [{ type: 'text', text:
      `You're on the **${state.step}** step${state.address ? `, with the server at \`${state.address}\`` : ''}.\n\nIf the server isn't up yet, on that machine run:\n\n\`\`\`\ncd hearth-server/deploy/generic\n./install.sh\n\`\`\`` }] };
  },
});

if (new URLSearchParams(location.search).has('reset') || !setupState()) startSetup();

export default function SetupPreview() {
  const theme = new URLSearchParams(location.search).get('theme');
  useEffect(() => { if (theme === 'dark' || theme === 'light') setThemeMode(theme); }, [theme]);
  useTheme();
  return <div className="h-full"><Setup onDone={(id) => { document.body.dataset.setupDone = id; }} /></div>;
}
