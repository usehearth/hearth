// Hearth's own actions on a message (servers with the `fork` extension): "Rewind to here" on a user message starts a
// new thread from before it, optionally with the project's files put back as they were then. The thread pane provides
// them; the message action bar shows the button only when they are there.
import { createContext, useContext, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';

export interface MessageActions {
  /** Start a new thread from before this user message; restoreFiles also puts the files back. */
  rewind: (messageId: string, restoreFiles: boolean, replace: boolean) => Promise<void>;
}
export const MessageActionsContext = createContext<MessageActions | null>(null);

export function RewindButton() {
  const actions = useContext(MessageActionsContext);
  const messageId = useAuiState((s) => s.message.id);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(true);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!actions) return null;
  return (
    <>
      <TooltipIconButton tooltip="Rewind to here" className="aui-user-action-rewind" onClick={() => setOpen(true)}>
        <History />
      </TooltipIconButton>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rewind to before this message?</DialogTitle>
              <DialogDescription>The thread goes back to just before this message, with the message ready to edit.</DialogDescription>
            </DialogHeader>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>Also put the project's files back as they were then<span className="block text-xs text-muted-foreground">The files as they are now are kept too, so this can be undone.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>Rewind this thread<span className="block text-xs text-muted-foreground">The later messages move to an archived copy. Untick to keep this thread and start a new one instead.</span></span>
            </label>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={busy} onClick={async () => {
                setBusy(true); setErr(null);
                try { await actions.rewind(messageId, files, replace); setOpen(false); } catch (e) { setErr((e as Error).message); setBusy(false); }
              }}>{busy && <Loader2 className="size-3.5 animate-spin" />}Rewind</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
