import { assetUrl } from '@/lib/hostBridge';
import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { ClientApp, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { Button } from '@/components/ui/button';
import { addServer, hostOf, isDesktop, normaliseUrl, setKey, type Server } from '@/lib/servers';
import { friendly } from '@/lib/directory';

/** Checks the address and key with a real `initialize` before saving anything. */
async function probe(url: string, key: string): Promise<string> {
  const conn = new ClientApp({ name: 'hearth-probe' }).connect(createWebSocketStream(url, { protocols: ['acp', `bearer.${key}`] }));
  try {
    const r: any = await Promise.race([
      conn.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'hearth', version: '0.1.0' } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('No answer from the server.')), 8000)),
    ]);
    return String(r?.agentInfo?.title ?? r?.agentInfo?.name ?? 'ACP server');
  } finally { try { conn.close(); } catch { /* */ } }
}

export function AddServer({ first, onDone, onCancel }: { first: boolean; onDone: (id: string) => void; onCancel?: () => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [key, setKeyIn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    let wsUrl: string;
    try { wsUrl = normaliseUrl(url); } catch { setErr('That address does not look right.'); return; }
    setBusy(true);
    try {
      const agent = await probe(wsUrl, key);
      const s = addServer({ name: name || agent || hostOf(url), url: wsUrl, key });
      onDone(s.id);
    } catch (e2) { setErr(friendly(e2)); } finally { setBusy(false); }
  };

  return (
    <div className="grid h-full place-items-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-md">
        <img src={assetUrl('logo.svg')} alt="" className="mx-auto size-16 rounded-2xl shadow-md" />
        <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight">{first ? 'Welcome to Hearth' : 'Add a server'}</h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">Connect to the server that keeps your chats. Any ACP server works.</p>
        <div className="mt-7 space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          <Field label="Server address" hint="For example wss://ai.home.example or 192.168.1.20:8080">
            <input autoFocus required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="wss://…" className={inputCls} />
          </Field>
          <Field label="Device key" hint={isDesktop ? 'Made on your server for this device. Saved in your system keychain.' : 'Made on your server for this device. Kept in memory for this window.'}>
            <input required type="password" value={key} onChange={(e) => setKeyIn(e.target.value)} placeholder="Paste the key" className={inputCls} autoComplete="off" />
          </Field>
          <Field label="Name (optional)">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home" className={inputCls} />
          </Field>
          {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
            <Button type="submit" disabled={busy || !url || !key}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}Connect</Button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Hearth keeps no chat content on this device and sends no telemetry.</p>
      </form>
    </div>
  );
}

/** The key is not kept between launches in the web build: ask for it again. */
export function KeyPrompt({ server, onSaved, compact }: { server: Server; onSaved: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const [key, setKeyIn] = useState('');
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><KeyRound className="size-3.5" />New key</Button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) { setKey(server.id, key); onSaved(); } }} className="mx-1 mt-2 rounded-xl border bg-card p-3">
      <p className="text-sm font-medium">Device key for {server.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{isDesktop ? 'Saved in your system keychain.' : 'Kept in memory for this window only.'}</p>
      <input autoFocus type="password" value={key} onChange={(e) => setKeyIn(e.target.value)} className={`${inputCls} mt-2`} placeholder="Paste the key" autoComplete="off" />
      <Button size="sm" className="mt-2 w-full" type="submit" disabled={!key.trim()}>Unlock</Button>
    </form>
  );
}

const inputCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
