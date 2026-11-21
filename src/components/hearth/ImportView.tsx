// The import with the guide beside it (docs/import.md, docs/setup-guide.md): the flow on the left, and on the right
// the guide (src/components/hearth/HelpPanel.tsx), when this desktop keeps a guide model key. Without one the flow
// works the same; the panel offers to add a key. The guide only reads: what the import found, and the receipt the
// server counted.
import { useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpPanel, type PageTools } from '@/components/hearth/HelpPanel';
import { ImportWizard } from '@/components/hearth/ImportWizard';
import { importGreeting, importPrompt, toolsFor } from '@/lib/guide';
import { importSnapshot } from '@/lib/importState';
import { forGuide, type Receipt } from '@/lib/receipt';
import { isDesktop } from '@/lib/servers';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export function ImportView(props: { request: Request; serverName: string; admin: boolean; part?: 'skills'; onDone: (project?: { slug: string; name: string }) => void;
  setup?: { onSkip: () => void; onContinue: (summary: string) => void } }) {
  const [panel, setPanel] = useState<'open' | 'closed'>(() => (window.matchMedia?.('(min-width: 1100px)').matches ? 'open' : 'closed'));
  const { request } = props;
  /** The server's client names (the same ones the import holds skills back for). Unknown: hide nothing extra. */
  const clientTerms = useCallback(async () => { try { return (await request<{ clientTerms?: string[] }>('_hearth/import/info')).clientTerms ?? []; } catch { return []; } }, [request]);
  // What the guide can read here. Both answers pass the panel's guard (client names, keys); the receipt also leaves out
  // Claude Code conversation titles (docs/import.md, The guide).
  const pageTools = useMemo<PageTools>(() => ({
    importSources: async () => importSnapshot() ?? { phase: 'not open', note: 'The import screen is not open.' },
    importReceipt: async () => {
      try { const r = await request<{ receipt: Receipt }>('_hearth/import/receipt'); return forGuide(r.receipt, await clientTerms()); }
      catch { return null; }
    },
  }), [request, clientTerms]);
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <ImportWizard {...props} />
        {isDesktop && panel === 'closed' && (
          <Button size="sm" variant="outline" className="absolute bottom-4 right-6 bg-card shadow-xs" onClick={() => setPanel('open')}><Sparkles className="size-3.5 text-primary" />Ask the guide</Button>
        )}
      </div>
      {isDesktop && panel === 'open' && (
        <HelpPanel page="import" serverName={props.serverName} greeting={importGreeting()} system={(os) => importPrompt(os)} tools={toolsFor('import')}
          pageTools={pageTools} clientTerms={clientTerms} onClose={() => setPanel('closed')}
          intro={'The guide explains what was found, recommends what to do, and answers questions like "did my Work chats come across?" from the receipt. It needs a model key, kept in your system keychain. Everything on the left works without it.'} />
      )}
    </div>
  );
}
