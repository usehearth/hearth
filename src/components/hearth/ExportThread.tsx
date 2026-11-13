// Export a thread (like Claude Code's /export): the conversation as Markdown, copied or saved as a file. Tool calls
// are summed up in a line each (edits with their diff), so the export reads like the thread.
import { useAuiState } from '@assistant-ui/react';
import { DropdownMenu } from 'radix-ui';
import { Copy, Download, FileDown } from 'lucide-react';
import { acpMetaOf, diffsOf } from '@/components/hearth/ToolViews';
import { createTwoFilesPatch } from 'diff';

type Part = { type: string; text?: string; toolName?: string; args?: unknown; providerMetadata?: unknown };

export function threadMarkdown(title: string, messages: readonly { role: string; content: readonly Part[] }[]): string {
  const out: string[] = [`# ${title}`, '', `_Exported from Hearth, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_`, ''];
  for (const m of messages) {
    const lines: string[] = [];
    for (const p of m.content) {
      if (p.type === 'text' && p.text) lines.push(p.text);
      else if (p.type === 'reasoning' && p.text) lines.push(`> _Thinking:_ ${p.text.replace(/\n/g, '\n> ')}`);
      else if (p.type === 'tool-call') {
        const meta = acpMetaOf(p);
        const title = (meta?.title ?? p.toolName ?? 'tool').replace(/`/g, '');
        lines.push(`- **${title}**${meta?.status === 'failed' ? ' (failed)' : ''}`);
        for (const d of diffsOf(meta)) lines.push('', '```diff', createTwoFilesPatch(d.path, d.path, d.oldText ?? '', d.newText).split('\n').slice(2).join('\n').trimEnd(), '```');
      }
    }
    if (!lines.length) continue;
    out.push(`## ${m.role === 'user' ? 'You' : 'Agent'}`, '', ...lines, '');
  }
  return out.join('\n');
}

export function ExportThread({ title }: { title: string }) {
  const messages = useAuiState((s) => s.thread.messages);
  const md = () => threadMarkdown(title || 'Thread', messages as never);
  const save = () => {
    const blob = new Blob([md()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'thread').replace(/[^\w.-]+/g, '-').slice(0, 60)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const item = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent';
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger title="Export the thread" aria-label="Export the thread"
        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent">
        <FileDown className="size-4" /><span className="max-sm:sr-only">Export</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <DropdownMenu.Item className={item} onSelect={() => void navigator.clipboard.writeText(md())}><Copy className="size-3.5" />Copy as Markdown</DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={save}><Download className="size-3.5" />Save as a file</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
