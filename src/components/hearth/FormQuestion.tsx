// A question the agent asks with a form (Claude Code's AskUserQuestion, or an MCP server's form): the ACP elicitation's
// JSON schema drawn as choices. One choice per question (radio), several (checkboxes), or free text; "Other" fields
// take a typed answer. Send answers it; Skip declines.
import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Opt = { const: string; title?: string; description?: string };
type Prop = { type?: string; title?: string; description?: string; oneOf?: Opt[]; enum?: string[]; items?: { anyOf?: Opt[]; enum?: string[] } };

const optsOf = (p: Prop): Opt[] | null => p.oneOf ?? (p.enum ? p.enum.map((e) => ({ const: e })) : null);
const multiOf = (p: Prop): Opt[] | null => (p.type === 'array' ? p.items?.anyOf ?? p.items?.enum?.map((e) => ({ const: e })) ?? null : null);

export function FormQuestion({ schema, busy, onSend, onSkip }: {
  schema: unknown; busy: boolean;
  onSend: (content: Record<string, unknown>) => void; onSkip: () => void;
}) {
  const props = Object.entries(((schema as { properties?: Record<string, Prop> })?.properties) ?? {});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  const answered = props.some(([k]) => { const v = values[k]; return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== ''; });
  return (
    <form className="mt-2.5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSend(Object.fromEntries(Object.entries(values).filter(([, v]) => (Array.isArray(v) ? v.length : String(v ?? '').trim())))); }}>
      {props.map(([key, p]) => {
        const single = optsOf(p), multi = multiOf(p);
        return (
          <fieldset key={key} className="space-y-1.5">
            {(p.title || p.description) && <legend className="text-sm"><span className="font-medium">{p.title}</span>{p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}</legend>}
            {single && single.map((o) => (
              <label key={o.const} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-accent', values[key] === o.const && 'border-primary bg-primary/5')}>
                <input type="radio" name={key} checked={values[key] === o.const} onChange={() => set(key, o.const)} className="mt-0.5 accent-primary" />
                <span><span>{o.title ?? o.const}</span>{o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}</span>
              </label>
            ))}
            {multi && multi.map((o) => {
              const cur = (values[key] as string[] | undefined) ?? [];
              return (
                <label key={o.const} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-accent', cur.includes(o.const) && 'border-primary bg-primary/5')}>
                  <input type="checkbox" checked={cur.includes(o.const)} onChange={(e) => set(key, e.target.checked ? [...cur, o.const] : cur.filter((x) => x !== o.const))} className="mt-0.5 accent-primary" />
                  <span><span>{o.title ?? o.const}</span>{o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}</span>
                </label>
              );
            })}
            {!single && !multi && (
              <input value={String(values[key] ?? '')} onChange={(e) => set(key, e.target.value)} aria-label={p.title ?? key} placeholder={p.title === 'Other' ? 'Or type your own answer' : ''}
                className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            )}
          </fieldset>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!answered || busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Send</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onSkip}>Skip</Button>
      </div>
    </form>
  );
}
