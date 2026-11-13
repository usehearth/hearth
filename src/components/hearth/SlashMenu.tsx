// The "/" menu in the composer: the agent's own slash commands (ACP available_commands_update: /compact, /init,
// /review, the owner's custom commands...). Typing "/" at the start opens it; arrows move, Enter or Tab picks, Escape
// closes. Picking a command puts "/name " in the composer so a hint or argument can follow; sending it runs it.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { FileText, SquareSlash, X } from 'lucide-react';
import { useAcpAvailableCommands } from '@/vendor/acp';
import { cn } from '@/lib/utils';

export interface SlashCommand { name: string; description?: string; input?: { hint?: string } | null }

/** Commands matching what follows the "/" (prefix matches first, then anywhere in the name or description). */
export function matchCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const pre = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const rest = commands.filter((c) => !pre.includes(c) && (c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)));
  return [...pre, ...rest];
}

/** The "/word" being typed, when the composer holds only that (no space yet). */
export const slashQuery = (text: string) => (/^\/[^\s/]*$/.test(text) ? text.slice(1) : null);

/** "@file": the project's files matching what follows the @ (the thread pane provides it when the server can). */
export const MentionContext = createContext<((query: string) => Promise<string[]>) | null>(null);
/** Messages typed while the agent works: queued and sent in order when it finishes (the thread pane provides it). */
export const QueueContext = createContext<{ items: string[]; add: (text: string) => void; remove: (i: number) => void } | null>(null);

/** The "@word" at the end of what is being typed. */
export const mentionQuery = (text: string) => { const m = /(^|\s)@([^\s@]*)$/.exec(text); return m ? m[2] : null; };

/** "!command": run a shell command in the thread (the thread pane provides it when the server can). */
export const ShellContext = createContext<((command: string) => Promise<void>) | null>(null);

export function useSlashMenu() {
  const runShell = useContext(ShellContext);
  const findFiles = useContext(MentionContext);
  const queue = useContext(QueueContext);
  const running = useAuiState((s) => s.thread.isRunning);
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const commands = (useAcpAvailableCommands() ?? []) as readonly SlashCommand[];
  const query = slashQuery(text);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const items = useMemo(() => (query == null ? [] : matchCommands(commands, query)), [commands, query]);
  // @-mentions: files matching what follows the @ (asked a moment after typing stops).
  const mq = findFiles ? mentionQuery(text) : null;
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (mq == null || !findFiles) { setFiles([]); return; }
    let live = true;
    const t = setTimeout(() => { findFiles(mq).then((f) => live && setFiles(f), () => live && setFiles([])); }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [mq, findFiles]);
  const mentionOpen = mq != null && files.length > 0 && closedFor !== text;
  const open = (query != null && items.length > 0 && closedFor !== text) || mentionOpen;
  const count = mentionOpen ? files.length : items.length;
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [query, mq]);
  const pickFile = (f: string) => { aui.composer.setText(text.replace(/@[^\s@]*$/, `@${f} `), { origin: 'user' } as never); };

  const pick = (c: SlashCommand) => { aui.composer.setText(`/${c.name} `, { origin: 'user' } as never); };
  const shellMode = !!runShell && /^!\S/.test(text);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // "!command" + Enter: a shell command, not a message to the agent.
    if (shellMode && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const command = text.slice(1).trim();
      aui.composer.setText('', { origin: 'user' } as never);
      void runShell!(command);
      return;
    }
    if (!open) {
      // While the agent works, Enter queues the message (sent when it finishes), as in Claude Code.
      if (running && queue && e.key === 'Enter' && !e.shiftKey && text.trim() && !e.nativeEvent.isComposing) {
        e.preventDefault();
        queue.add(text.trim());
        aui.composer.setText('', { origin: 'user' } as never);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % count); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + count) % count); }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      if (mentionOpen) pickFile(files[Math.min(active, files.length - 1)]); else pick(items[Math.min(active, items.length - 1)]);
    }
    else if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); }
  };

  const fileMenu = mentionOpen ? (
    <div role="listbox" aria-label="Files" className="absolute right-0 bottom-full left-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
      {files.map((f, i) => (
        <button key={f} role="option" aria-selected={i === active} type="button"
          onMouseDown={(e) => { e.preventDefault(); pickFile(f); }} onMouseEnter={() => setActive(i)}
          className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left', i === active && 'bg-accent')}>
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate"><span className="font-medium">{f.slice(f.lastIndexOf('/') + 1)}</span><span className="ml-2 font-mono text-xs text-muted-foreground">{f}</span></span>
        </button>
      ))}
    </div>
  ) : null;
  const menu = open && !mentionOpen ? (
    <div role="listbox" aria-label="Slash commands" className="absolute right-0 bottom-full left-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
      {items.map((c, i) => (
        <button key={c.name} role="option" aria-selected={i === active} type="button"
          onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}
          className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === active && 'bg-accent')}>
          <SquareSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="font-mono font-medium">/{c.name}</span>
            {c.input?.hint && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{c.input.hint}</span>}
            {c.description && <span className="block truncate text-xs text-muted-foreground">{c.description}</span>}
          </span>
        </button>
      ))}
    </div>
  ) : null;
  const hint = shellMode ? (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-2 rounded-lg border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
      <span className="font-mono text-foreground">!</span> Shell: Enter runs it in this thread's folder (as the agent's user); the agent sees the output next turn.
    </div>
  ) : null;
  const queued = queue && queue.items.length > 0 ? (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 space-y-1">
      {queue.items.map((q, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1 text-xs shadow-xs">
          <span className="shrink-0 text-muted-foreground">Queued</span><span className="min-w-0 flex-1 truncate">{q}</span>
          <button type="button" aria-label="Remove from the queue" onClick={() => queue.remove(i)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      ))}
    </div>
  ) : null;
  return { menu: fileMenu ?? menu ?? hint ?? queued, onKeyDown };
}
