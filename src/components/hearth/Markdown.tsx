// Markdown outside a chat message (the plan panel, file previews). Same look as the chat's markdown, no raw HTML.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('hearth-md text-sm leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" />,
        }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
