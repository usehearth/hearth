import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The inline confirm from the guide (section 8, Buttons): "Delete this job? [Delete] [Keep]". Use it instead of window.confirm. */
export function ConfirmLine({ question, yes, no = 'Keep', destructive = true, busy, onYes, onNo, className }: {
  question: ReactNode; yes: string; no?: string; destructive?: boolean; busy?: boolean; onYes: () => void; onNo: () => void; className?: string;
}) {
  return (
    <div role="group" aria-label="Confirm" className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
      <span className="text-foreground">{question}</span>
      <Button size="xs" variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onYes}>{busy && <Loader2 className="size-3 animate-spin" />}{yes}</Button>
      <Button size="xs" variant="ghost" onClick={onNo}>{no}</Button>
    </div>
  );
}
