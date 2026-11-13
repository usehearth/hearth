// The thread's Tasks tab: the subagents its agent started (Claude Code's Task/Agent tool) and anything still running
// (long shell commands, fetches), newest first, from the thread's own tool calls. Click one to jump to it.
import { useMemo } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Bot, CircleCheck, CircleX, Loader2, Wrench } from 'lucide-react';
import { acpMetaOf } from '@/components/hearth/ToolViews';
import { cn } from '@/lib/utils';

interface Row { id: string; label: string; detail?: string; subagent: boolean; state: 'running' | 'done' | 'failed' }

const SUBAGENT = /^(Task|Agent|task)$/;

export function useThreadTasks(): Row[] {
  const messages = useAuiState((s) => s.thread.messages);
  return useMemo(() => {
    const rows: Row[] = [];
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const p of m.content) {
        if (p.type !== 'tool-call') continue;
        const meta = acpMetaOf(p as { providerMetadata?: unknown });
        const name = meta?.tool ?? meta?.name ?? p.toolName;
        const sub = SUBAGENT.test(name);
        const running = meta?.status === 'pending' || meta?.status === 'in_progress';
        if (!sub && !running) continue;
        const args = (p.args ?? {}) as Record<string, unknown>;
        rows.push({
          id: p.toolCallId,
          label: sub ? String(args.description ?? meta?.title ?? 'Subagent') : String(meta?.title ?? name).replace(/`/g, ''),
          detail: sub ? String(args.subagent_type ?? args.agent ?? '') || undefined : undefined,
          subagent: sub,
          state: running ? 'running' : meta?.status === 'failed' || p.isError ? 'failed' : 'done',
        });
      }
    }
    return rows.reverse();
  }, [messages]);
}

export function TasksList() {
  const rows = useThreadTasks();
  if (!rows.length) return <p className="px-4 py-3 text-sm text-muted-foreground">No subagents or running tasks in this thread.</p>;
  return (
    <ul className="space-y-1 px-2 py-2" aria-label="Tasks">
      {rows.map((r) => (
        <li key={r.id}>
          <button onClick={() => document.querySelector(`[data-tool-call-id="${CSS.escape(r.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
            {r.subagent ? <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1"><span className="block truncate">{r.label}</span>{r.detail && <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>}</span>
            {r.state === 'running' ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
              : r.state === 'failed' ? <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              : <CircleCheck className={cn('mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400')} />}
          </button>
        </li>
      ))}
    </ul>
  );
}
