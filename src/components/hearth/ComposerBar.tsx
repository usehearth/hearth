// Beside the composer: the thread's mode (Ask / Accept edits / Plan), its model (the model provider, and the engine's
// own model and effort settings when it reports them) and how full the context is. Changes apply to the live session
// and stick to the thread on the server, so every window and later session uses them.
import { useEffect, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Cpu, FileEdit, Hand, ListTodo, Zap } from 'lucide-react';
import { useAcpConfigOptions, useAcpCurrentModeId, type AcpClient } from '@/vendor/acp';
import { UsageMeter } from '@/components/hearth/UsageMeter';
import { cn } from '@/lib/utils';

const MODE_ICON: Record<string, typeof Hand> = { default: Hand, acceptEdits: FileEdit, plan: ListTodo, auto: Zap };
const FALLBACK_MODES = [
  { id: 'default', name: 'Ask', description: 'Asks before anything not pre-approved' },
  { id: 'acceptEdits', name: 'Accept edits', description: 'Edits inside the project without asking' },
  { id: 'plan', name: 'Plan', description: 'Reads and plans; changes nothing' },
];

const pill = 'flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=open]:bg-accent';
const menu = 'z-50 min-w-48 max-w-72 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md';
const item = 'flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-accent';

export function ComposerBar({ client, onError }: { client: AcpClient; onError: (m: string) => void }) {
  const hasModes = Array.isArray(client.initializeMeta?.hearth?.extensions) && (client.initializeMeta!.hearth!.extensions as string[]).includes('modes');
  return (
    <>
      {hasModes && <ModePicker client={client} onError={onError} />}
      {hasModes && <ModelPicker client={client} onError={onError} />}
      <UsageMeter />
    </>
  );
}

function ModePicker({ client, onError }: { client: AcpClient; onError: (m: string) => void }) {
  const [, redraw] = useState(0);
  const liveMode = useAcpCurrentModeId();
  const current = (client.sessionId ? undefined : client.beforeSession.mode) ?? liveMode ?? client.modes?.currentModeId ?? 'default';
  const modes = (client.modes?.availableModes as { id: string; name: string; description?: string | null }[] | undefined) ?? FALLBACK_MODES;
  const cur = modes.find((m) => m.id === current) ?? FALLBACK_MODES[0];
  const Icon = MODE_ICON[cur.id] ?? Hand;
  const live = !!client.sessionId;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={pill} title={live ? `Mode: ${cur.name}` : `Mode for the first message: ${cur.name}`} aria-label={`Mode: ${cur.name}`}>
        <Icon className="size-3.5" /><span className="max-sm:hidden">{cur.name}</span><ChevronDown className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className={menu}>
          {modes.map((m) => {
            const I = MODE_ICON[m.id] ?? Hand;
            return (
              <DropdownMenu.Item key={m.id} className={item} onSelect={() => { if (m.id !== cur.id) client.setMode(m.id).then(() => redraw((n) => n + 1), (e) => onError((e as Error).message)); }}>
                <I className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span>{m.description && <span className="block text-xs text-muted-foreground">{m.description}</span>}</span>
                {m.id === cur.id && <Check className="mt-0.5 size-3.5 text-primary" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface Provider { name: string; kind: string; enabled: boolean; status?: string; models?: Record<string, unknown>; sensitive_ok?: boolean }

/**
 * What the model pill says: a model picked by name (an OpenCode provider's), else the engine's current model
 * ("Sonnet 5.5", or "Sonnet 5.5 · primary" when a provider is picked), else the provider picked, else "Auto". The model comes first, as in Claude's picker.
 */
export function modelLabel({ chosenModel, chosen, engineModel }: { chosenModel?: string | null; chosen?: string | null; engineModel?: { currentValue: unknown; options?: { value: string; name: string }[] } | null }): string {
  if (chosenModel) return chosenModel;
  // With a provider picked, say which, so a model name never hides a change of provider.
  if (engineModel) { const m = engineModel.options?.find((v) => v.value === engineModel.currentValue)?.name ?? String(engineModel.currentValue); return chosen ? `${m} · ${chosen}` : m; }
  return chosen ?? 'Auto';
}
type SelectOption = { id: string; name: string; category?: string | null; type: string; currentValue: unknown; options?: { value: string; name: string; description?: string | null }[] };

/**
 * The model: which provider (Auto = the project's order, with failover) and the engine's own selectors (model, effort,
 * thinking) when it reports them. A provider change takes effect on the next message, with a summary of the thread.
 */
function ModelPicker({ client, onError }: { client: AcpClient; onError: (m: string) => void }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => (client.sessionMeta?.provider as string | null) ?? null);
  const [chosenModel, setChosenModel] = useState<string | null>(() => (client.sessionMeta?.model as string | null) ?? null);
  const [otherModel, setOtherModel] = useState('');
  const live = !!client.sessionId;
  useEffect(() => { setChosen((client.sessionMeta?.provider as string | null) ?? null); }, [client, live]);
  const config = ((useAcpConfigOptions() ?? client.configOptions ?? []) as unknown as SelectOption[])
    .filter((o) => o.type === 'select' && Array.isArray(o.options) && o.category !== 'mode' && !/^(mode|permission_?mode)$/i.test(o.id));
  // Only the providers this thread may use (the server answers for the thread or its project: a client project only
  // gets providers OK for client work). A server from before that answers with every provider and no `project`; a
  // client thread then still only shows the ones OK for client work.
  const load = () => {
    if (providers) return;
    const scope = client.sessionId ? { sessionId: client.sessionId } : client.newProject ? { project: client.newProject } : {};
    client.extRequest<{ providers: Provider[]; project?: string }>('_hearth/providers', scope).then((r) => {
      const clientThread = !r.project && !!client.sessionMeta?.client;
      setProviders(r.providers.filter((p) => p.enabled && (!clientThread || p.sensitive_ok)));
    }, () => setProviders([]));
  };
  const engineModel = config.find((o) => o.category === 'model' || o.id === 'model');
  const label = modelLabel({ chosenModel, chosen, engineModel });
  // A model by name goes with an OpenCode provider (its engine offers one model only); Claude Code threads pick theirs
  // from the engine's own model list below.
  const pickProvider = (name: string | null, model: string | null = null) => {
    if (!client.sessionId) { client.beforeSession = { ...client.beforeSession, provider: { name, model } }; setChosen(name); setChosenModel(model); return; }
    client.extRequest('_hearth/thread/provider', { sessionId: client.sessionId, provider: name, ...(model ? { model } : {}) })
      .then(() => { setChosen(name); setChosenModel(model); }, (e) => onError((e as Error).message));
  };
  const modelsOf = (p: Provider) => {
    const m = (p.models ?? {}) as { list?: unknown; default?: unknown; strong?: unknown; fast?: unknown };
    return [...new Set([...(Array.isArray(m.list) ? m.list : []), m.default, m.strong, m.fast].filter((x): x is string => typeof x === 'string' && !!x))];
  };
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(o) => o && load()}>
      <DropdownMenu.Trigger className={pill} title={live ? `Model: ${label}` : `Model for the first message: ${label}`} aria-label={`Model: ${label}`}>
        <Cpu className="size-3.5" /><span className="max-w-32 truncate max-sm:hidden">{label}</span><ChevronDown className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className={cn(menu, 'max-h-96 overflow-y-auto')}>
          {!engineModel && (
            <>
              <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Model</DropdownMenu.Label>
              <div className="px-2 pb-1.5 text-xs text-muted-foreground">{live ? 'The agent lists its models with its first reply in this window.' : 'The agent lists its models once the thread starts.'}</div>
            </>
          )}
          {config.map((o, i) => (
            <div key={o.id}>
              {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{o.name}</DropdownMenu.Label>
              {o.options!.map((v) => (
                <DropdownMenu.Item key={v.value} className={item} onSelect={() => { if (v.value !== o.currentValue) client.setConfigOption(o.id, v.value).catch((e) => onError((e as Error).message)); }}>
                  <span className="min-w-0 flex-1"><span>{v.name}</span>{v.description && <span className="block text-xs text-muted-foreground">{v.description}</span>}</span>
                  {v.value === o.currentValue && <Check className="mt-0.5 size-3.5 text-primary" />}
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Model provider</DropdownMenu.Label>
          <DropdownMenu.Item className={item} onSelect={() => pickProvider(null)}>
            <span className="min-w-0 flex-1"><span className="font-medium">Auto</span><span className="block text-xs text-muted-foreground">The project's order; moves on when one is down</span></span>
            {!chosen && <Check className="mt-0.5 size-3.5 text-primary" />}
          </DropdownMenu.Item>
          {providers === null && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
          {providers?.map((p) => (
            <DropdownMenu.Item key={p.name} className={item} onSelect={() => pickProvider(p.name)}>
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', p.status === 'ok' ? 'bg-success' : p.status === 'down' ? 'bg-destructive' : 'bg-muted-foreground/40')} />
              <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.kind === 'anthropic' ? 'Claude (Claude Code)' : 'Any model (OpenCode)'}</span></span>
              {chosen === p.name && !chosenModel && <Check className="mt-0.5 size-3.5 text-primary" />}
            </DropdownMenu.Item>
          ))}
          {providers?.filter((p) => p.kind !== 'anthropic').map((p) => (
            <div key={`m-${p.name}`}>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{p.name}: model</DropdownMenu.Label>
              {modelsOf(p).map((m) => (
                <DropdownMenu.Item key={m} className={item} onSelect={() => pickProvider(p.name, m)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{m}</span>
                  {chosen === p.name && chosenModel === m && <Check className="mt-0.5 size-3.5 text-primary" />}
                </DropdownMenu.Item>
              ))}
              <form className="flex gap-1 px-2 py-1" onSubmit={(e) => { e.preventDefault(); if (otherModel.trim()) pickProvider(p.name, otherModel.trim()); }}>
                <input value={otherModel} onChange={(e) => setOtherModel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Other model id"
                  aria-label={`Another model on ${p.name}`} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs" />
                <button type="submit" className="rounded-md border px-2 text-xs hover:bg-accent" disabled={!otherModel.trim()}>Use</button>
              </form>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
