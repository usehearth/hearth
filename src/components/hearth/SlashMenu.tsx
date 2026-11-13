// The "/" menu in the composer: the agent's own slash commands (ACP available_commands_update: /compact, /init,
// /review, the owner's custom commands...). Typing "/" at the start opens it; arrows move, Enter or Tab picks, Escape
// closes. Picking a command puts "/name " in the composer so a hint or argument can follow; sending it runs it.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { SquareSlash } from 'lucide-react';
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

/** "!command": run a shell command in the thread (the thread pane provides it when the server can). */
export const ShellContext = createContext<((command: string) => Promise<void>) | null>(null);

export function useSlashMenu() {
  const runShell = useContext(ShellContext);
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const commands = (useAcpAvailableCommands() ?? []) as readonly SlashCommand[];
  const query = slashQuery(text);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const items = useMemo(() => (query == null ? [] : matchCommands(commands, query)), [commands, query]);
  const open = query != null && items.length > 0 && closedFor !== text;
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [query]);

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
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); }
    else if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); }
  };

  const menu = open ? (
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
  return { menu: menu ?? hint, onKeyDown };
}
