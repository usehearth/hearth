// Admin threads in Hearth (server extension `admin_threads`). Run as the owner on the admin runner's machine with no
// project walls; four hard lines hold (secrets never printed, reboots and permanent deletes come to you as commands,
// client folders refused, CLIProxyAPI changes need your yes). Every call is audited in a hash chain; this file shows that
// audit beside the chat, the commands handed to you (with Copy), the "worth a look" flags, and the admin key settings.
import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, Copy, KeyRound, Loader2, ShieldAlert, ShieldCheck, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminJson, adminKeyHome, adminPublicKey, createAdminKey, keyFingerprint, LINE_NAMES, type AdminFlag, type AdminInfo, type AuditEntry } from '@/lib/admin';
import { errorText } from '@/lib/hearth';
import { cn } from '@/lib/utils';

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
const CHANGED = 'hearth:admin-key-changed';

/** This install's admin key: its public half (null: none), and whether the server's admin runner pinned it. */
export function useAdminKey(request?: Request, enabled = true) {
  const [pub, setPub] = useState<string | null | undefined>(undefined);
  const [fp, setFp] = useState<string | null>(null);
  const [server, setServer] = useState<AdminInfo | null>(null);
  const read = useCallback(async () => {
    const p = await adminPublicKey().catch(() => null);
    setPub(p);
    setFp(p ? await keyFingerprint(p) : null);
    if (request && enabled) setServer(await request<AdminInfo>('_hearth/admin').catch(() => null));
  }, [request, enabled]);
  // Every copy of this state (sidebar, settings, a thread) reads again when one of them changes it, and on focus.
  useEffect(() => {
    void read();
    const again = () => void read();
    window.addEventListener(CHANGED, again);
    window.addEventListener('focus', again);
    return () => { window.removeEventListener(CHANGED, again); window.removeEventListener('focus', again); };
  }, [read]);
  const load = useCallback(async () => { await read(); window.dispatchEvent(new Event(CHANGED)); }, [read]);
  /** This install can sign for the admin runner: it has a key and the runner pinned that key. */
  const pinned = !!fp && !!server?.keyFingerprint && server.keyFingerprint === fp;
  return { pub, fp, server, pinned, reload: load };
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{done ? 'Copied' : label}
    </Button>
  );
}

// ---------- Settings > Admin ----------

export function AdminKeySettings({ request }: { request: Request }) {
  const k = useAdminKey(request);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const home = adminKeyHome();
  const make = async () => { setBusy(true); setErr(null); try { await createAdminKey(); await k.reload(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Admin threads</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">An admin thread runs as you on the laptop, with no project walls. It can edit the Monolith and any personal project. Four hard lines still hold: secrets are never printed, reboots and permanent deletes come to you as commands, client folders are refused, and CLIProxyAPI changes need your yes. Everything is audited.</p>
      </div>
      <div className="rounded-xl border p-4 text-sm">
        <div className="flex items-center gap-2 font-medium"><KeyRound className="size-4" />This install's admin key</div>
        {home === null && <p className="mt-2 text-muted-foreground">Admin keys live in the desktop app, in the system keychain. In a browser you can watch admin threads but not type in them.</p>}
        {home !== null && k.pub === undefined && <p className="mt-2 text-muted-foreground"><Loader2 className="inline size-3.5 animate-spin" /> Reading the keychain…</p>}
        {home !== null && k.pub === null && (
          <>
            <p className="mt-2 text-muted-foreground">No admin key yet. Make one: it stays in {home === 'keychain' ? 'the system keychain' : 'this browser (development only)'} and signs every admin message you send.</p>
            <Button className="mt-3" size="sm" disabled={busy} onClick={() => void make()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}Make admin key</Button>
          </>
        )}
        {k.pub && (
          <>
            <p className="mt-2">Key <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{k.fp}</code> {home === 'dev-browser' && <span className="text-xs text-amber-700 dark:text-amber-300">(development key in this browser)</span>}</p>
            {k.pinned
              ? <p className="mt-2 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><ShieldCheck className="size-4" />The laptop runner has this key pinned. You can type in admin threads here.</p>
              : (
                <div className="mt-3 space-y-2">
                  <p className="text-muted-foreground">{k.server?.keyFingerprint
                    ? <>The laptop runner has a different key pinned (<code className="text-xs">{k.server.keyFingerprint}</code>).</>
                    : k.server?.runnerOnline === false ? 'No runner has admin threads on yet.' : 'Pin this key on the laptop runner:'}
                  </p>
                  <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
                    <li>Save this as <code className="text-xs">admin.json</code> in the runner's data folder (<code className="text-xs">%USERPROFILE%\.monolith\admin.json</code>). Only you write that file.</li>
                    <li>Restart the runner. It then runs admin threads only with prompts this key signed.</li>
                  </ol>
                  <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">{adminJson(k.pub)}</pre>
                  <div className="flex gap-2"><CopyBtn text={adminJson(k.pub)} label="Copy admin.json" /><Button size="sm" variant="outline" onClick={() => void k.reload()}>Check again</Button></div>
                </div>
              )}
          </>
        )}
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
      </div>
      {k.server && <ChainLine chain={k.server.chain} />}
    </div>
  );
}

function ChainLine({ chain }: { chain: AdminInfo['chain'] }) {
  return chain.ok
    ? <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-px size-3.5 shrink-0" />Audit chain intact: {chain.entries} entr{chain.entries === 1 ? 'y' : 'ies'}{chain.laptopHead ? `, matches the laptop's head (#${chain.laptopHead.seq})` : ''}.</p>
    : <p className="flex items-start gap-1.5 text-xs text-destructive"><ShieldAlert className="mt-px size-3.5 shrink-0" />Audit chain broken: {chain.why}.</p>;
}

// ---------- beside an admin thread ----------

/** The strip above an admin thread: what it is, whether this install can type in it, and Finish. */
export function AdminStrip({ canSign, commands, origin, onFinish }: { canSign: boolean; commands: number; origin: boolean; onFinish?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-rose-500/8 px-5 py-1.5 text-xs text-rose-900 max-md:px-3 dark:text-rose-200" role="note">
      <span className="flex items-center gap-1.5"><ShieldAlert className="size-3.5 shrink-0" /><span className="font-semibold">Admin.</span> Runs as you on the laptop, no project walls; every call audited.</span>
      {!canSign && <span className="font-medium">Watch only on this device.</span>}
      {commands > 0 && <span className="flex items-center gap-1 font-medium"><Terminal className="size-3.5" />{commands} command{commands > 1 ? 's' : ''} for you to run (Audit)</span>}
      {onFinish && <button onClick={onFinish} className="ml-auto rounded-md px-2 py-0.5 font-medium hover:bg-rose-500/15">{origin ? 'Finish and tell the thread' : 'Finish'}</button>}
    </div>
  );
}

/** The admin thread's audit: commands handed to you (Copy), flags, then every call. Read with `_hearth/admin/timeline`. */
export function useAdminTimeline(request: Request | null, sessionId: string | undefined) {
  const [t, setT] = useState<{ entries: AuditEntry[]; flags: AdminFlag[]; chain: AdminInfo['chain'] } | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (!request || !sessionId) return;
    setLoading(true);
    request<{ entries: AuditEntry[]; flags: AdminFlag[]; chain: AdminInfo['chain'] }>('_hearth/admin/timeline', { sessionId })
      .then(setT, () => setT(null)).finally(() => setLoading(false));
  }, [request, sessionId]);
  useEffect(() => { load(); }, [load]);
  return { timeline: t, loading, reload: load };
}

export function AdminAudit({ timeline, loading }: { timeline: { entries: AuditEntry[]; flags: AdminFlag[]; chain: AdminInfo['chain'] } | null; loading: boolean }) {
  if (!timeline) return <p className="px-4 py-3 text-sm text-muted-foreground">{loading ? 'Reading the audit…' : 'No audit yet.'}</p>;
  const commands = timeline.entries.filter((e) => e.outcome === 'command' && e.detail);
  return (
    <div className="space-y-4 px-4 py-3 text-sm">
      {commands.length > 0 && (
        <section aria-label="Commands for you to run">
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">For you to run</h3>
          <div className="space-y-2">
            {commands.map((e) => (
              <div key={e.seq} className="rounded-xl border border-rose-500/30 bg-card p-2.5">
                <div className="text-xs text-muted-foreground">{LINE_NAMES[e.line ?? ''] ?? e.line}: never run by the agent</div>
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs whitespace-pre-wrap break-all">{e.detail}</pre>
                <div className="mt-1.5"><CopyBtn text={e.detail!} label="Copy command" /></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {timeline.flags.length > 0 && (
        <section aria-label="Worth a look" className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-2.5">
          <div className="flex items-center gap-1.5 font-medium"><CircleAlert className="size-4 text-amber-600" />Worth a look</div>
          <ul className="mt-1 ml-5 list-disc space-y-0.5 text-xs">{timeline.flags.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
        </section>
      )}
      <ChainLine chain={timeline.chain} />
      <ol className="space-y-1.5" aria-label="Every call">
        {timeline.entries.map((e) => {
          const bad = e.outcome === 'refused' || e.outcome === 'command' || e.outcome === 'unchecked';
          return (
            <li key={e.seq} className={cn('rounded-lg px-2 py-1.5', bad ? 'bg-rose-500/8' : 'bg-muted/40')}>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium">{e.kind === 'tool' || e.kind === 'card' ? e.tool : e.kind.replace('_', ' ')}</span>
                {e.line && <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{LINE_NAMES[e.line] ?? e.line}</span>}
                <span className={cn('text-[11px]', bad ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground')}>{(e.outcome ?? '').replace('_', ' ')}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
              {e.detail && <div className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">{e.detail}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Finish: the line that goes back to the thread this admin thread came from (editable), then archive. */
export function FinishAdmin({ title, origin, onDone, onCancel, request, sessionId }: { title: string; origin: boolean; onDone: () => void; onCancel: () => void; request: Request; sessionId: string }) {
  const [line, setLine] = useState(`Admin fixed: ${title.replace(/^Fix:\s*/i, '')}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await request('_hearth/admin/finish', { sessionId, line }); onDone(); } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  return (
    <div className="border-b bg-card px-5 py-3 text-sm max-md:px-3" role="dialog" aria-label="Finish this admin thread">
      {origin ? <label className="block text-xs text-muted-foreground" htmlFor="finish-line">The line that goes back to the original thread:</label> : <p className="text-xs text-muted-foreground">Finishing archives this admin thread. Its audit stays.</p>}
      {origin && <input id="finish-line" value={line} onChange={(e) => setLine(e.target.value)} className="mt-1 h-8 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />}
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={busy || (origin && !line.trim())} onClick={() => void go()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{origin ? 'Send and finish' : 'Finish'}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** Needs you: the admin flags ("worth a look"), each opening its thread. */
export function AdminFlags({ request, onOpen }: { request: Request; onOpen: (sessionId: string, title: string) => void }) {
  const [flags, setFlags] = useState<(AdminFlag & { title: string })[]>([]);
  useEffect(() => { void request<AdminInfo>('_hearth/admin').then((a) => setFlags(a?.flags ?? []), () => setFlags([])); }, [request]);
  if (!flags.length) return null;
  return (
    <section aria-label="Admin: worth a look" className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium"><ShieldAlert className="size-4 text-amber-600" />Admin: worth a look</div>
      <ul className="mt-1.5 space-y-1">
        {flags.map((f, i) => (
          <li key={i}><button onClick={() => onOpen(f.chatId, f.title)} className="text-left hover:underline"><span className="font-medium">{f.title}</span>: {f.text}</button></li>
        ))}
      </ul>
    </section>
  );
}
