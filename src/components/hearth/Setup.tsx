// First-run setup with the guide (docs/setup-guide.md). A checklist that works on its own, with an optional chat
// beside it. The guide's model calls and the key live in the desktop shell (src-tauri/src/guide.rs). The Import step
// is the app's own import view (src/components/hearth/ImportWizard.tsx), opened by App with the guide beside it.
import { useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, ExternalLink, KeyRound, Loader2, MessageCircleQuestion, Server as ServerIcon, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { field } from '@/components/ui/field';
import { AddServer } from '@/components/hearth/AddServer';
import { GuideChat } from '@/components/hearth/GuideChat';
import { assetUrl } from '@/lib/hostBridge';
import { addServer, hostOf, keyFor, normaliseUrl, useServers } from '@/lib/servers';
import { friendly } from '@/lib/directory';
import { cn } from '@/lib/utils';
import {
  STEPS, finishSetup, nextStep, noteSetup, providerVerdict, setupState, stepIndex, updateSetup, useSetup,
  type GuideModel, type ProviderKind, type ServerProvider, type SetupState, type Step, type Where,
} from '@/lib/setup';
import { GET_KEY_LINKS, greeting, osName, pickModel, systemPrompt, toolsFor, type ToolEnv } from '@/lib/guide';
import { errText, openLink, shell, type AddressCheck, type DockerCheck } from '@/lib/guideShell';
export { previewShell } from '@/lib/guideShell';

/** An address check in words (docs/ux-and-brand.md: say what failed, from the user's side). */
export function addressWords(r: AddressCheck): string {
  switch (r.result) {
    case 'ok': return 'Your server answered.';
    case 'answered': return `Something answered there (status ${r.status ?? '?'}), but it doesn't look like a Hearth server.`;
    case 'refused': return 'Nothing is listening at that address. The server may not be running yet, the port may be wrong, or a firewall is in the way.';
    case 'timeout': return 'No answer in time. Check the IP address, that both machines are on the same network, and the firewall.';
    case 'dns': return "That name doesn't lead anywhere. Check the spelling, or use the machine's IP address.";
    case 'tls': return 'The secure connection failed. On a home network, use ws:// rather than wss://.';
    default: return `The check failed${r.detail ? ` (${r.detail})` : ''}.`;
  }
}

// ---------- the whole setup ----------

export function Setup({ onDone }: { onDone: (serverId: string) => void }) {
  const s = useSetup();
  const [haveServer, setHaveServer] = useState(false);
  const [resumed] = useState(() => (setupState()?.step ?? 'key') !== 'key');
  const [missingKey, setMissingKey] = useState(false);

  // Resuming with the guide on: is its key still in the keychain?
  useEffect(() => {
    if (!s?.guide || s.step === 'key') return;
    shell.status().then((st) => { if (!st) { setMissingKey(true); updateSetup({ step: 'key' }); } }, () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  if (haveServer) {
    return <AddServer first onCancel={() => setHaveServer(false)} onDone={(id) => { void shell.forget().catch(() => {}); finishSetup(); onDone(id); }} />;
  }
  if (s.step === 'key') return <KeyScreen notice={missingKey ? "The guide's key isn't on this device any more. Check it again, or carry on without help." : undefined} onHaveServer={() => setHaveServer(true)} />;
  return <Workspace s={s} resumed={resumed} onDone={onDone} />;
}

// ---------- step 1: the key ----------

const KINDS: { id: 'claude' | 'openai' | 'local'; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'local', label: 'Local model' },
];

/** The guide's model key: checked with real calls, then kept in the system keychain. Used by setup and the import view. */
export function GuideKeyForm({ onChecked, notice, footer }: { onChecked: (guide: GuideModel) => void; notice?: string; footer?: React.ReactNode }) {
  const [kind, setKind] = useState<'claude' | 'openai' | 'local'>('claude');
  const [base, setBase] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(notice ?? null);
  const pk: ProviderKind = kind === 'claude' ? 'anthropic' : 'openai';
  const baseUrl = kind === 'claude' ? '' : base.trim() || (kind === 'local' ? 'http://localhost:11434/v1' : '');

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      setBusy('Checking the key…');
      const { models } = await shell.check(pk, baseUrl, key.trim() || null, null);
      const model = pickModel(pk, models);
      setBusy(`Trying ${model}…`);
      await shell.check(pk, baseUrl, null, model);
      const st = await shell.status();
      setKey('');
      onChecked({ kind: pk, baseUrl: st?.base_url ?? baseUrl, model, models, ...(kind === 'local' ? { local: true } : {}) });
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(null); }
  };

  const keyLink = kind === 'claude' ? GET_KEY_LINKS.anthropic : kind === 'openai' ? GET_KEY_LINKS.openai : GET_KEY_LINKS.ollama;
  return (
    <form onSubmit={check} className="space-y-4">
      <div role="radiogroup" aria-label="Model provider" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => { setKind(k.id); setErr(null); }}
            className={cn('rounded-md px-2 py-1.5 text-xs font-medium transition-colors', kind === k.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {k.label}
          </button>
        ))}
      </div>
      {kind !== 'claude' && (
        <Field label="API address" hint={kind === 'local' ? 'Ollama: http://localhost:11434/v1. LM Studio: http://localhost:1234/v1.' : 'For example https://api.openai.com/v1 or https://openrouter.ai/api/v1'}>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder={kind === 'local' ? 'http://localhost:11434/v1' : 'https://…/v1'} className={field} required={kind === 'openai'} />
        </Field>
      )}
      {kind !== 'local' && (
        <Field label={kind === 'claude' ? 'Anthropic API key' : 'API key'} hint="Saved in your system keychain. Only sent to this provider.">
          <input autoFocus type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" className={field} autoComplete="off" required={kind === 'claude'} />
        </Field>
      )}
      {kind === 'local' && <p className="text-xs text-muted-foreground">No key needed. The model runs on this computer, so it must be running now.</p>}
      {err && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{err}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" variant="link" size="sm" className="px-0" onClick={() => void openLink(keyLink)}>
          <ExternalLink className="size-3.5" />{kind === 'local' ? 'Get Ollama' : 'Get a key'}
        </Button>
        <Button type="submit" disabled={!!busy || (kind === 'claude' && !key.trim()) || (kind === 'openai' && !base.trim())}>
          {busy ? <><Loader2 className="size-4 animate-spin" />{busy}</> : <><ShieldCheck className="size-4" />Check key</>}
        </Button>
      </div>
      {footer}
    </form>
  );
}

function KeyScreen({ onHaveServer, notice }: { onHaveServer: () => void; notice?: string }) {
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-md">
        <img src={assetUrl('logo.svg')} alt="" className="mx-auto size-16 rounded-2xl shadow-md" />
        <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight">Welcome to Hearth</h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">Start with a model key. A setup guide then walks you through the rest and answers questions on the way.</p>
        <div className="mt-7 rounded-2xl border bg-card p-5 shadow-sm">
          {/* Back to where the person was (the guide can be turned on part way through). */}
          <GuideKeyForm notice={notice} onChecked={(guide) => updateSetup((cur) => ({ guide, step: cur.serverId ? (cur.step === 'key' ? 'provider' : cur.step) : cur.address ? 'connect' : 'server' }))} />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          <Button type="button" variant="link" size="sm" onClick={onHaveServer}>I already have a server</Button>
          <Button type="button" variant="link" size="sm" onClick={() => updateSetup({ guide: null, step: 'server' })}>Set up without help</Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">During setup Hearth talks only to the provider you pick here. It sends no telemetry and keeps no chat content.</p>
      </div>
    </div>
  );
}

// ---------- the checklist and the guide ----------

function Workspace({ s, resumed, onDone }: { s: SetupState; resumed: boolean; onDone: (serverId: string) => void }) {
  // The device key field lives here so the chat can move a pasted key into it.
  const [deviceKey, setDeviceKey] = useState('');
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background md:flex-row md:overflow-hidden">
      <aside className="flex min-h-0 shrink-0 flex-col overflow-y-auto border-b p-5 md:w-[400px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5">
          <img src={assetUrl('logo.svg')} alt="" className="size-8 rounded-lg" />
          <h1 className="text-lg font-semibold tracking-tight">Set up Hearth</h1>
        </div>
        <ol className="mt-5 space-y-2">
          {STEPS.map((st) => <StepRow key={st.id} id={st.id} label={st.label} s={s} deviceKey={deviceKey} setDeviceKey={setDeviceKey} onDone={onDone} />)}
        </ol>
      </aside>
      <section className="flex min-h-[80vh] min-w-0 flex-1 flex-col md:min-h-0">
        {s.guide
          ? <SetupGuide key={`${s.guide.kind}:${s.guide.baseUrl}:${s.guide.model}`} s={s} guide={s.guide} resumed={resumed} onKey={(k) => setDeviceKey(k)} />
          : (
            <div className="grid flex-1 place-items-center p-6">
              <div className="max-w-sm rounded-xl border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
                <MessageCircleQuestion className="mx-auto mb-2 size-5" />
                You're setting up without the guide. If you get stuck, add a model key and it can check things for you.
                <div className="mt-3"><Button size="sm" variant="outline" onClick={() => updateSetup({ step: 'key' })}><Sparkles className="size-3.5" />Get help from the guide</Button></div>
              </div>
            </div>
          )}
      </section>
    </div>
  );
}

function StepRow({ id, label, s, deviceKey, setDeviceKey, onDone }: { id: Step; label: string; s: SetupState; deviceKey: string; setDeviceKey: (k: string) => void; onDone: (serverId: string) => void }) {
  const cur = stepIndex(s.step);
  const me = stepIndex(id);
  const done = me < cur || (id === 'key' && !!s.guide);
  const open = id === s.step;
  // A finished step can be opened again (except the key, which has its own screen, and Connect once saved).
  const canReopen = done && id !== 'key' && !(id === 'connect' && s.serverId) && !(id === 'server' && s.serverId);
  return (
    <li className={cn('rounded-xl border', open ? 'bg-card shadow-sm' : 'border-transparent')}>
      <button type="button" disabled={!canReopen} onClick={() => updateSetup({ step: id })} aria-current={open ? 'step' : undefined}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:cursor-default">
        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-[11px]', done ? 'border-primary bg-primary text-primary-foreground' : open ? 'border-primary text-primary' : 'text-muted-foreground')}>
          {done ? <Check className="size-3" /> : me + 1}
        </span>
        <span className={cn('font-medium', !open && !done && 'text-muted-foreground')}>{id === 'key' && !s.guide ? 'Model key (skipped)' : label}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-[42px]">
          {id === 'server' && <ServerStep s={s} />}
          {id === 'connect' && <ConnectStep s={s} deviceKey={deviceKey} setDeviceKey={setDeviceKey} />}
          {id === 'provider' && <ProviderStep s={s} />}
          {id === 'import' && <p className="text-sm text-muted-foreground">Bring your conversations, chats, memories and skills from Claude.</p>}
          {id === 'done' && <DoneStep s={s} onDone={onDone} />}
        </div>
      )}
    </li>
  );
}

const WHERE: { id: Where; label: string; hint: string }[] = [
  { id: 'here', label: 'This computer', hint: 'Needs Docker here, and this computer left on.' },
  { id: 'other', label: 'Another computer I own', hint: 'A home server, NAS or spare PC with Docker.' },
  { id: 'given', label: 'I have an address already', hint: 'Someone set one up for you.' },
];

function ServerStep({ s }: { s: SetupState }) {
  const [addr, setAddr] = useState(s.address ?? (s.where === 'here' ? 'localhost:8470' : ''));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AddressCheck | null>(null);
  const [docker, setDocker] = useState<DockerCheck | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const pick = (w: Where) => { updateSetup({ where: w }); setRes(null); if (w === 'here' && !addr) setAddr('localhost:8470'); };

  const checkDocker = async () => {
    setDockerBusy(true);
    try {
      const d = await shell.docker();
      setDocker(d);
      noteSetup('docker', !d.installed ? 'Docker is not installed on this computer' : d.running ? `Docker ${d.version ?? ''} is running` : `Docker is installed but its engine isn't running${d.detail ? ` (${d.detail})` : ''}`);
    } catch (e) { noteSetup('docker', errText(e)); } finally { setDockerBusy(false); }
  };
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    let url: string;
    try { url = normaliseUrl(addr); } catch { setRes({ tried: addr, result: 'error', detail: "that address doesn't look right" }); return; }
    setBusy(true); setRes(null);
    try {
      const r = await shell.address(url);
      setRes(r);
      noteSetup('address', `${url}: ${r.result}${r.detail ? ` (${r.detail})` : ''}`);
      if (r.result === 'ok') updateSetup({ address: url, step: 'connect' });
    } catch (e2) { setRes({ tried: url, result: 'error', detail: errText(e2) }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Where will your Hearth server run?</p>
      <div className="grid gap-1.5">
        {WHERE.map((w) => (
          <button key={w.id} type="button" onClick={() => pick(w.id)} aria-pressed={s.where === w.id}
            className={cn('rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent', s.where === w.id && 'border-primary bg-primary/5')}>
            <span className="block text-sm font-medium">{w.label}</span>
            <span className="block text-xs text-muted-foreground">{w.hint}</span>
          </button>
        ))}
      </div>
      {s.where === 'here' && (
        <div className="flex items-center gap-2 text-xs">
          <Button size="xs" variant="outline" onClick={() => void checkDocker()} disabled={dockerBusy}>{dockerBusy ? <Loader2 className="animate-spin" /> : <Wrench />}Check Docker</Button>
          {docker && <span className={docker.running ? 'text-muted-foreground' : 'text-destructive'}>{!docker.installed ? 'Docker isn\'t installed.' : docker.running ? `Docker ${docker.version ?? ''} is running.` : "Docker is installed but not running."}</span>}
        </div>
      )}
      {(s.where === 'here' || s.where === 'other') && <InstallSteps here={s.where === 'here'} />}
      {s.where && (
        <form onSubmit={check} className="space-y-2">
          <Field label="Server address" hint={s.where === 'here' ? 'localhost works when the server runs on this computer.' : "The other machine's IP address and port, for example 192.168.1.20:8470"}>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="192.168.1.20:8470" className={field} required />
          </Field>
          {res && res.result !== 'ok' && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              {addressWords(res)}
              {res.result === 'answered' && <div className="mt-1.5"><Button size="xs" variant="outline" type="button" onClick={() => updateSetup({ address: normaliseUrl(addr), step: 'connect' })}>Connect anyway</Button></div>}
            </div>
          )}
          <Button type="submit" size="sm" disabled={busy || !addr.trim()}>{busy ? <><Loader2 className="size-3.5 animate-spin" />Checking…</> : <><ServerIcon className="size-3.5" />Check address</>}</Button>
        </form>
      )}
    </div>
  );
}

function InstallSteps({ here }: { here: boolean }) {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>{here ? 'On this computer' : 'On that computer'}, with Docker and git installed{here && osName() === 'Windows' ? ' (on Windows, run these in WSL or Git Bash)' : ''}:</p>
      <CopyBlock text={'git clone https://github.com/usehearth/hearth-server.git\ncd hearth-server/deploy/generic\ncp .env.example .env'} />
      <p>Open <code>.env</code> and put a model key for the server in it, for example <code>ANTHROPIC_API_KEY=…</code>. Then:</p>
      <CopyBlock text="./install.sh" />
      <p>The first build takes a few minutes. At the end it prints the address and a device key. Keep the key for the next step.</p>
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      {/* Wrapped, not scrolled: the checklist column is narrow, and a scrolled line would run under the Copy button. */}
      <pre className="whitespace-pre-wrap break-all rounded-lg border bg-muted/50 px-3 py-2 pr-9 font-mono text-[12px] leading-relaxed text-foreground">{text}</pre>
      <Button type="button" size="icon-xs" variant="ghost" className="absolute right-1.5 top-1.5" aria-label="Copy"
        onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function ConnectStep({ s, deviceKey, setDeviceKey }: { s: SetupState; deviceKey: string; setDeviceKey: (k: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s.address) return;
    setErr(null); setBusy(true);
    try {
      const r = await shell.server(s.address, deviceKey.trim());
      const server = addServer({ name: name || r.agent || hostOf(s.address), url: s.address, key: deviceKey });
      setDeviceKey('');
      noteSetup('connect', `connected (${r.agent})`);
      updateSetup({ serverId: server.id, step: 'provider' });
    } catch (e2) {
      const m = friendly(e2);
      setErr(m); noteSetup('connect', `failed: ${m}`);
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={connect} className="space-y-3">
      <p className="text-sm text-muted-foreground">Server: <span className="font-mono text-xs text-foreground">{s.address}</span>{' '}
        <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => updateSetup({ step: 'server' })}>Change</Button></p>
      <Field label="Device key" hint="install.sh printed it. Saved in your system keychain.">
        <input type="password" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value)} placeholder="Paste the key" className={field} autoComplete="off" required />
      </Field>
      <Field label="Name (optional)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home" className={field} /></Field>
      {err && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{err}</p>}
      <Button type="submit" size="sm" disabled={busy || !deviceKey.trim()}>{busy ? <><Loader2 className="size-3.5 animate-spin" />Connecting…</> : <><KeyRound className="size-3.5" />Connect</>}</Button>
    </form>
  );
}

/** The server's model providers: read with the device key (any device may read them). */
async function readProviders(s: SetupState): Promise<ServerProvider[] | null> {
  const server = s.serverId ? keyFor(s.serverId) : undefined;
  if (!s.address || !server) throw new Error('Not connected yet.');
  const info = await shell.server(s.address, server);
  if (!info.extensions.includes('providers')) return null;
  const r = await shell.server(s.address, server, '_hearth/providers') as { result?: { providers: ServerProvider[] } };
  return r.result?.providers ?? [];
}

function ProviderStep({ s }: { s: SetupState }) {
  const [busy, setBusy] = useState(true);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setBusy(true); setErr(null);
    try { const v = providerVerdict(await readProviders(s)); setVerdict(v); noteSetup('provider', v.text); }
    catch (e) { const m = friendly(e); setErr(m); noteSetup('provider', `check failed: ${m}`); } finally { setBusy(false); }
  };
  useEffect(() => { void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3 text-sm">
      {busy && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Checking…</p>}
      {!busy && err && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">{err}</p>}
      {!busy && verdict && <p className={cn(!verdict.ok && 'flex gap-2')}>{!verdict.ok && <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}{verdict.text}</p>}
      {!busy && verdict && !verdict.ok && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>On the server machine, put a key in <code>deploy/generic/.env</code> (for example <code>ANTHROPIC_API_KEY=…</code>) and restart it:</p>
          <CopyBlock text="docker compose up -d" />
          <p>The key in .env is only read on the server's first start. If it has started before, add the provider in Hearth's Settings instead (from an admin device: tick "admin device" for your key on the server's web page).</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {verdict?.ok ? <Button size="sm" onClick={() => updateSetup({ step: nextStep('provider') })}>Continue</Button>
          : <>
            <Button size="sm" variant="outline" onClick={() => void check()} disabled={busy}>Check again</Button>
            <Button size="sm" variant="ghost" onClick={() => updateSetup({ step: nextStep('provider') })}>Skip for now</Button>
          </>}
      </div>
    </div>
  );
}

function DoneStep({ s, onDone }: { s: SetupState; onDone: (serverId: string) => void }) {
  const servers = useServers();
  const server = servers.find((x) => x.id === s.serverId);
  const [keep, setKeep] = useState(false);
  const finish = async () => {
    if (!keep) await shell.forget().catch(() => {});
    if (!keep) updateSetup({ guide: null });
    finishSetup();
    if (s.serverId) onDone(s.serverId);
  };
  return (
    <div className="space-y-3 text-sm">
      <p>You're set up{server ? <> with <b>{server.name}</b></> : null}.{s.notes?.provider ? ` ${s.notes.provider}` : ''}</p>
      {s.notes?.import && <p className="text-muted-foreground">Your Claude history: {s.notes.import}</p>}
      {s.guide && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-0.5 accent-primary" />
          <span>Keep the guide's model key on this device, for help later. Off by default: Hearth then holds no model key of its own.</span>
        </label>
      )}
      <Button size="sm" onClick={() => void finish()} disabled={!s.serverId}>Open Hearth</Button>
    </div>
  );
}

// ---------- the guide's chat ----------

function SetupGuide({ s, guide, resumed, onKey }: { s: SetupState; guide: GuideModel; resumed: boolean; onKey: (k: string) => void }) {
  const env: ToolEnv = {
    state: () => setupState() ?? s,
    checkAddress: async (url) => { const u = normaliseUrl(url); const r = await shell.address(u); return { ...r, meaning: addressWords(r) }; },
    checkDocker: () => shell.docker(),
    probe: async () => {
      const st = setupState();
      const k = st?.serverId ? keyFor(st.serverId) : undefined;
      if (!st?.address || !k) return { connected: false, note: 'Not connected yet: the Connect step comes first.' };
      try { const r = await shell.server(st.address, k); return { connected: true, agent: r.agent, extensions: r.extensions.length }; }
      catch (e) { return { connected: false, error: friendly(e) }; }
    },
    providers: async () => {
      const st = setupState();
      if (!st) return null;
      const rows = await readProviders(st);
      return { providers: rows?.map((r) => ({ name: r.name, kind: r.kind, enabled: r.enabled, status: r.status, last_error: r.last_error })) ?? 'not reported by this server', verdict: providerVerdict(rows).text };
    },
    openLink,
  };
  return (
    <GuideChat guide={guide} greeting={greeting(s, resumed)} env={env} tools={toolsFor('setup').filter((t) => !t.name.startsWith('import_'))}
      system={(os) => systemPrompt(setupState() ?? s, os)}
      onKey={(k) => { if ((setupState() ?? s).step === 'connect') onKey(k); }} keyTarget={(setupState() ?? s).step === 'connect' ? 'Move it to the device key field' : undefined} />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
