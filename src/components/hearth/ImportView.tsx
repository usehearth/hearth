// The import with the guide beside it (docs/import.md, docs/setup-guide.md): the flow on the left, and on the right
// the guide, when this desktop keeps a guide model key. Without one the flow works the same; a small panel offers to
// add a key. The guide only reads: what the import found, and the receipt the server counted.
import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuideChat } from '@/components/hearth/GuideChat';
import { GuideKeyForm } from '@/components/hearth/Setup';
import { ImportWizard } from '@/components/hearth/ImportWizard';
import { importGreeting, importPrompt, pickModel, toolsFor, type ToolEnv } from '@/lib/guide';
import { openLink, shell } from '@/lib/guideShell';
import { importSnapshot } from '@/lib/importState';
import { forGuide, type Receipt } from '@/lib/receipt';
import { isDesktop } from '@/lib/servers';
import { setupState, updateSetup, useSetup, type GuideModel } from '@/lib/setup';
import { cn } from '@/lib/utils';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

export function ImportView(props: { request: Request; serverName: string; admin: boolean; part?: 'skills'; onDone: (project?: { slug: string; name: string }) => void;
  setup?: { onSkip: () => void; onContinue: (summary: string) => void } }) {
  const [guide, setGuide] = useState<GuideModel | null | undefined>(undefined);
  const [panel, setPanel] = useState<'open' | 'closed'>(() => (window.matchMedia?.('(min-width: 1100px)').matches ? 'open' : 'closed'));
  const [adding, setAdding] = useState(false);
  const s = useSetup();
  // Is a guide key kept on this device? Its model: setup's choice when it is for the same provider, else picked again.
  useEffect(() => {
    if (!isDesktop) { setGuide(null); return; }
    let live = true;
    shell.status().then(async (st) => {
      if (!st) return live && setGuide(null);
      const saved = setupState()?.guide;
      if (saved && saved.kind === st.kind && (saved.baseUrl === st.base_url || !saved.baseUrl)) return live && setGuide({ ...saved, baseUrl: st.base_url });
      const { models } = await shell.check(st.kind, st.base_url, null, null);
      if (live) setGuide({ kind: st.kind, baseUrl: st.base_url, model: pickModel(st.kind, models), models });
    }).catch(() => live && setGuide(null));
    return () => { live = false; };
  }, [s?.guide?.model]);

  const env: ToolEnv = {
    state: () => setupState() ?? { v: 1, active: false, step: 'done', guide: null },
    checkAddress: async () => ({ note: 'Not needed here: you are connected.' }),
    checkDocker: async () => ({ note: 'Not needed here.' }),
    probe: async () => ({ connected: true, server: props.serverName }),
    providers: async () => ({ note: 'See Settings, Model providers.' }),
    openLink,
    importSources: async () => importSnapshot() ?? { phase: 'not open', note: 'The import screen is not open.' },
    importReceipt: async () => {
      try { const r = await props.request<{ receipt: Receipt }>('_hearth/import/receipt'); return forGuide(r.receipt); }
      catch { return null; }
    },
  };
  const pickModel_ = (m: string) => { if (!guide) return; setGuide({ ...guide, model: m }); if (setupState()) updateSetup({ guide: { ...guide, model: m } }); };
  const showPanel = isDesktop && panel === 'open';
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <ImportWizard {...props} />
        {isDesktop && panel === 'closed' && (
          <Button size="sm" variant="outline" className="absolute right-4 top-4 bg-card" onClick={() => setPanel('open')}><Sparkles className="size-3.5 text-primary" />Ask the guide</Button>
        )}
      </div>
      {showPanel && (
        <aside aria-label="Guide" className={cn('flex w-[360px] shrink-0 flex-col border-l bg-background', 'max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(360px,90vw)] max-lg:shadow-2xl')}>
          <div className="flex justify-end px-2 pt-2"><Button size="icon-sm" variant="ghost" aria-label="Close the guide" title="Close the guide" onClick={() => setPanel('closed')}><X /></Button></div>
          {guide === undefined && <p className="px-4 text-sm text-muted-foreground">Checking for the guide…</p>}
          {guide && (
            <GuideChat key={`${guide.kind}:${guide.baseUrl}:${guide.model}`} guide={guide} title="Guide" greeting={importGreeting()} env={env} tools={toolsFor('import')}
              system={(os) => importPrompt(os)} onModel={pickModel_}
              footer={<p className="mt-1 text-center text-[11px]"><button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => { void shell.forget().then(() => { setGuide(null); if (setupState()?.guide) updateSetup({ guide: null }); }); }}>Forget the guide's key on this device</button></p>} />
          )}
          {guide === null && (
            <div className="space-y-3 overflow-y-auto px-4 pb-4 text-sm">
              <p className="flex items-center gap-2 font-medium"><MessageCircleQuestion className="size-4 text-muted-foreground" />Get help from the guide</p>
              <p className="text-muted-foreground">The guide explains what was found, recommends what to do, and answers questions like "did my Work chats come across?" from the receipt. It needs a model key, kept in your system keychain. Everything on the left works without it.</p>
              {!adding ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Sparkles className="size-3.5" />Add a model key</Button>
                : <GuideKeyForm onChecked={(g) => { setGuide(g); setAdding(false); if (setupState()) updateSetup({ guide: g }); }} />}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

