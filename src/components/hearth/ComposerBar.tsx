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

const pill = 'flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=open]:bg-accent';
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
  const current = useAcpCurrentModeId() ?? client.modes?.currentModeId ?? 'default';
  const modes = (client.modes?.availableModes as { id: string; name: string; description?: string | null }[] | undefined) ?? FALLBACK_MODES;
  const cur = modes.find((m) => m.id === current) ?? FALLBACK_MODES[0];
  const Icon = MODE_ICON[cur.id] ?? Hand;
  const live = !!client.sessionId;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={pill} disabled={!live} title={live ? `Mode: ${cur.name}` : 'Send a message first'} aria-label={`Mode: ${cur.name}`}>
        <Icon className="size-3.5" /><span className="max-sm:hidden">{cur.name}</span><ChevronDown className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className={menu}>
          {modes.map((m) => {
            const I = MODE_ICON[m.id] ?? Hand;
            return (
              <DropdownMenu.Item key={m.id} className={item} onSelect={() => { if (m.id !== cur.id) client.setMode(m.id).catch((e) => onError((e as Error).message)); }}>
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

interface Provider { name: string; kind: string; enabled: boolean; status?: string; models?: Record<string, unknown> }
type SelectOption = { id: string; name: string; category?: string | null; type: string; currentValue: unknown; options?: { value: string; name: string; description?: string | null }[] };

/**
 * The model: which provider (Auto = the project's order, with failover) and the engine's own selectors (model, effort,
 * thinking) when it reports them. A provider change takes effect on the next message, with a summary of the thread.
 */
function ModelPicker({ client, onError }: { client: AcpClient; onError: (m: string) => void }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => (client.sessionMeta?.provider as string | null) ?? null);
  const live = !!client.sessionId;
  useEffect(() => { setChosen((client.sessionMeta?.provider as string | null) ?? null); }, [client, live]);
  const config = ((useAcpConfigOptions() ?? client.configOptions ?? []) as unknown as SelectOption[])
    .filter((o) => o.type === 'select' && Array.isArray(o.options) && o.category !== 'mode' && !/^(mode|permission_?mode)$/i.test(o.id));
  const load = () => { if (!providers) client.extRequest<{ providers: Provider[] }>('_hearth/providers', {}).then((r) => setProviders(r.providers.filter((p) => p.enabled)), () => setProviders([])); };
  const engineModel = config.find((o) => o.category === 'model' || o.id === 'model');
  const label = chosen ?? (engineModel ? engineModel.options?.find((v) => v.value === engineModel.currentValue)?.name ?? String(engineModel.currentValue) : 'Auto');
  const pickProvider = (name: string | null) => {
    client.extRequest('_hearth/thread/provider', { sessionId: client.sessionId, provider: name }).then(() => setChosen(name), (e) => onError((e as Error).message));
  };
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(o) => o && load()}>
      <DropdownMenu.Trigger className={pill} disabled={!live} title={live ? `Model: ${label}` : 'Send a message first'} aria-label={`Model: ${label}`}>
        <Cpu className="size-3.5" /><span className="max-w-32 truncate max-sm:hidden">{label}</span><ChevronDown className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={6} className={cn(menu, 'max-h-96 overflow-y-auto')}>
          <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Model provider</DropdownMenu.Label>
          <DropdownMenu.Item className={item} onSelect={() => pickProvider(null)}>
            <span className="min-w-0 flex-1"><span className="font-medium">Auto</span><span className="block text-xs text-muted-foreground">The project's order; moves on when one is down</span></span>
            {!chosen && <Check className="mt-0.5 size-3.5 text-primary" />}
          </DropdownMenu.Item>
          {providers === null && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
          {providers?.map((p) => (
            <DropdownMenu.Item key={p.name} className={item} onSelect={() => pickProvider(p.name)}>
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', p.status === 'ok' ? 'bg-emerald-500' : p.status === 'down' ? 'bg-destructive' : 'bg-muted-foreground/40')} />
              <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.kind === 'anthropic' ? 'Claude (Claude Code)' : 'Any model (OpenCode)'}</span></span>
              {chosen === p.name && <Check className="mt-0.5 size-3.5 text-primary" />}
            </DropdownMenu.Item>
          ))}
          {config.map((o) => (
            <div key={o.id}>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{o.name}</DropdownMenu.Label>
              {o.options!.map((v) => (
                <DropdownMenu.Item key={v.value} className={item} onSelect={() => { if (v.value !== o.currentValue) client.setConfigOption(o.id, v.value).catch((e) => onError((e as Error).message)); }}>
                  <span className="min-w-0 flex-1"><span>{v.name}</span>{v.description && <span className="block text-xs text-muted-foreground">{v.description}</span>}</span>
                  {v.value === o.currentValue && <Check className="mt-0.5 size-3.5 text-primary" />}
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
