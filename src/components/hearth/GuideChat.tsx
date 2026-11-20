// The guide's chat (docs/setup-guide.md): used by first-run setup and by the import view. The model call and the key
// live in the desktop shell (src-tauri/src/guide.rs); this is the conversation, the tool calls and the key guard.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { field, fieldArea } from '@/components/ui/field';
import { Markdown } from '@/components/hearth/Markdown';
import { hostOf } from '@/lib/servers';
import { updateSetup, type GuideModel } from '@/lib/setup';
import { KEY_MARK, findKeys, osName, runTurn, type ChatItem, type History, type ToolDef, type ToolEnv } from '@/lib/guide';
import { errText, shell } from '@/lib/guideShell';
import { cn } from '@/lib/utils';

const SOFT_CAP = 300_000;

export function GuideChat({ guide, system, greeting, env, tools, onKey, keyTarget, title = 'Setup guide', onModel, footer }: {
  guide: GuideModel;
  /** The system prompt, read again before each turn (the situation changes as the person goes). */
  system: (os: string) => string;
  greeting: string;
  env: ToolEnv;
  tools: ToolDef[];
  /** A key pasted into the chat: where it can go instead (the device key field), if anywhere. */
  onKey?: (k: string) => void; keyTarget?: string;
  title?: string;
  /** A different model picked in the header (default: saved with setup's choices). */
  onModel?: (m: string) => void;
  footer?: React.ReactNode;
}) {
  const [items, setItems] = useState<ChatItem[]>(() => [{ kind: 'assistant', text: greeting }]);
  const history = useRef<History>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState<string[]>([]);
  const [used, setUsed] = useState(0);
  const [capOk, setCapOk] = useState(false);
  const [keyWarn, setKeyWarn] = useState<string[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const os = useMemo(() => osName(), []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [items, busy]);

  const send = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || busy) return;
    const keys = findKeys(msg);
    if (keys.length) { setKeyWarn(keys); return; }
    if (used > SOFT_CAP && !capOk) { setItems((x) => [...x, { kind: 'error', text: `This chat has used about ${Math.round(used / 1000)}k tokens. Send again to keep going.` }]); setCapOk(true); return; }
    setText(''); setReplies([]); setKeyWarn(null);
    setItems((x) => [...x, { kind: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await runTurn({ guide, system: system(os), history: history.current, text: msg, call: shell.call, env, tools, onItem: (i) => setItems((x) => [...x, i]) });
      history.current = r.history;
      setReplies(r.replies);
      setUsed((u) => u + r.usage.input + r.usage.output);
    } catch (e) {
      setItems((x) => [...x, { kind: 'error', text: `The guide couldn't answer: ${errText(e)} Everything on screen still works without it.` }]);
    } finally { setBusy(false); }
  };

  const moveKey = () => {
    if (!keyWarn) return;
    if (onKey) onKey(keyWarn[0]);
    let t = text;
    for (const k of keyWarn) t = t.split(k).join(KEY_MARK);
    setText(t); setKeyWarn(null);
    // The button goes away with the warning: back to the message, so Enter sends it.
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <Sparkles className="size-4 text-primary" />
        <span className="font-medium">{title}</span>
        <select value={guide.model} onChange={(e) => (onModel ?? ((m: string) => updateSetup({ guide: { ...guide, model: m } })))(e.target.value)} aria-label="Guide model" title="Changing the model starts the chat again"
          className={cn(field, 'ml-auto h-7 w-auto max-w-[200px] text-xs')}>
          {(guide.models.length ? guide.models : [guide.model]).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {items.map((it, i) => <ChatRow key={i} item={it} />)}
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Thinking…</p>}
          {!busy && replies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {replies.map((r) => <Button key={r} size="sm" variant="outline" onClick={() => void send(r)}>{r}</Button>)}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="mx-auto w-full max-w-2xl px-4 pb-4">
        {keyWarn && (
          <div role="alert" className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            This looks like a key, so it wasn't sent. Keys go in the fields on screen, never to the guide.
            <div className="mt-1.5 flex gap-2">
              <Button size="xs" type="button" onClick={moveKey}>{keyTarget ?? 'Take it out of the message'}</Button>
              <Button size="xs" type="button" variant="ghost" onClick={() => { setKeyWarn(null); inputRef.current?.focus(); }}>Keep editing</Button>
            </div>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm">
          <textarea ref={inputRef} value={text} onChange={(e) => { setText(e.target.value); if (keyWarn) setKeyWarn(null); }} rows={1} placeholder="Ask the guide anything…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            className={cn(fieldArea, 'max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0')} />
          <Button type="submit" size="icon-sm" disabled={busy || !text.trim()} aria-label="Send"><ArrowUp /></Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          {guide.local ? 'Runs on your local model.' : `Talks to ${hostOf(guide.baseUrl || 'https://api.anthropic.com')} with your key.`} Not saved anywhere.{used > 0 ? ` About ${used < 1000 ? used : `${Math.round(used / 1000)}k`} tokens so far.` : ''}
        </p>
        {footer}
      </form>
    </div>
  );
}

function ChatRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user': return <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary/10 px-3.5 py-2 text-sm">{item.text}</div>;
    case 'assistant': return <Markdown text={item.text} />;
    case 'tool': return <p className={cn('flex items-center gap-1.5 text-xs', item.error ? 'text-destructive' : 'text-muted-foreground')}><Wrench className="size-3" />{item.label}</p>;
    case 'error': return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{item.text}</p>;
  }
}
