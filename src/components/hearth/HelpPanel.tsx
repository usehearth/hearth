// The guide beside a page (sandbox/reports/guide-plan.md): the import screen and Settings open the same panel. It uses
// the guide key kept on this device (setup's, or one added here); without one, a short note says what the guide would
// do and offers to add a key, and the page works the same. The guide only reads what the page hands it, through one
// guard (src/lib/help.ts forModel), and never saves anything itself: what it fills in, the person saves.
import { useEffect, useMemo, useState } from 'react';
import { MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuideChat } from '@/components/hearth/GuideChat';
import { GuideKeyForm } from '@/components/hearth/Setup';
import { pickModel, type ToolDef, type ToolEnv } from '@/lib/guide';
import { openLink, shell } from '@/lib/guideShell';
import { guardTools, type HelpPage } from '@/lib/help';
import { isDesktop } from '@/lib/servers';
import { setupState, updateSetup, useSetup, type GuideModel } from '@/lib/setup';
import { cn } from '@/lib/utils';

/** The tools a page adds: each one's answer passes through forModel before the model sees it. */
export type PageTools = Omit<Partial<ToolEnv>, 'state' | 'openLink'>;

/** Is a guide key kept on this device? Its model: setup's choice when it is for the same provider, else picked again. */
export function useGuideModel() {
  const [guide, setGuide] = useState<GuideModel | null | undefined>(undefined);
  const s = useSetup();
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
  return [guide, setGuide] as const;
}

export function HelpPanel({ page, serverName, greeting, system, tools, pageTools, clientTerms, intro, onClose }: {
  /** The page it sits beside; it can change while the panel stays open (the chat carries on). */
  page: HelpPage;
  serverName: string;
  greeting: string;
  /** The system prompt, read again before each turn (so it follows the page and what is on it). */
  system: (os: string) => string;
  tools: ToolDef[];
  pageTools: PageTools;
  /** The client names to hide from the model (the server's, and any a page knows of). */
  clientTerms: () => Promise<string[]>;
  /** What the guide does here, shown while this device has no guide key. */
  intro: string;
  onClose: () => void;
}) {
  const [guide, setGuide] = useGuideModel();
  const [adding, setAdding] = useState(false);
  const env = useMemo<ToolEnv>(() => {
    const guarded = guardTools(pageTools, clientTerms);
    return {
      state: () => setupState() ?? { v: 1, active: false, step: 'done', guide: null },
      checkAddress: async () => ({ note: 'Not needed here: you are connected.' }),
      checkDocker: async () => ({ note: 'Not needed here.' }),
      probe: async () => ({ connected: true, server: serverName }),
      providers: async () => ({ note: 'See Settings, Model providers.' }),
      openLink,
      ...guarded,
    };
  }, [pageTools, clientTerms, serverName]);
  const pickModel_ = (m: string) => { if (!guide) return; setGuide({ ...guide, model: m }); if (setupState()) updateSetup({ guide: { ...guide, model: m } }); };
  return (
    <aside aria-label="Guide" data-page={page} className={cn('flex w-[360px] shrink-0 flex-col border-l bg-background', 'max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(360px,90vw)] max-lg:shadow-2xl')}>
      <div className="flex justify-end px-2 pt-2"><Button size="icon-sm" variant="ghost" aria-label="Close the guide" title="Close the guide" onClick={onClose}><X /></Button></div>
      {guide === undefined && <p className="px-4 text-sm text-muted-foreground">Checking for the guide…</p>}
      {guide && (
        <GuideChat key={`${guide.kind}:${guide.baseUrl}:${guide.model}`} guide={guide} title="Guide" greeting={greeting} env={env} tools={tools}
          system={system} onModel={pickModel_}
          footer={<p className="mt-1 text-center text-[11px]"><button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => { void shell.forget().then(() => { setGuide(null); if (setupState()?.guide) updateSetup({ guide: null }); }); }}>Forget the guide's key on this device</button></p>} />
      )}
      {guide === null && (
        <div className="space-y-3 overflow-y-auto px-4 pb-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><MessageCircleQuestion className="size-4 text-muted-foreground" />Get help from the guide</p>
          <p className="text-muted-foreground">{intro}</p>
          {!adding ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Sparkles className="size-3.5" />Add a model key</Button>
            : <GuideKeyForm onChecked={(g) => { setGuide(g); setAdding(false); if (setupState()) updateSetup({ guide: g }); }} />}
        </div>
      )}
    </aside>
  );
}
