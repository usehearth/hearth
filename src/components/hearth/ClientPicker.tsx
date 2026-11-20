// The Client field (New project, Project settings): pick a client already in use, none (a personal project), or
// "New client…" and type its name. One list, so the same client is never typed two ways.
import { useState } from 'react';
import { field } from '@/components/ui/field';

const NEW = '\u0000new';

export function ClientPicker({ value, onChange, clients, label = 'Client' }: {
  value: string; onChange: (v: string) => void; /** Client names in use, sorted. */ clients: readonly string[]; label?: string;
}) {
  const known = clients.some((c) => c.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(!!value.trim() && !known);
  const picked = typing ? NEW : known ? clients.find((c) => c.toLowerCase() === value.trim().toLowerCase())! : '';
  return (
    <span className="flex flex-col gap-1.5">
      <select aria-label={label} value={picked} className={field}
        onChange={(e) => { if (e.target.value === NEW) { setTyping(true); onChange(''); } else { setTyping(false); onChange(e.target.value); } }}>
        <option value="">No client (a personal project)</option>
        {clients.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value={NEW}>New client…</option>
      </select>
      {typing && <input aria-label="New client's name" value={value} onChange={(e) => onChange(e.target.value)} maxLength={60} autoFocus className={field} placeholder="The client's name, e.g. Acme" />}
    </span>
  );
}
