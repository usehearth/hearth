// The guide's desktop shell (src-tauri/src/guide.rs): model calls with the key kept in the system keychain, the
// address and Docker checks. Shared by first-run setup and the import view. A dev preview can swap in a made-up shell.
import { invoke } from '@tauri-apps/api/core';
import type { ProviderKind } from './setup';
import { serverCall } from './setup';

export interface AddressCheck { tried: string; result: 'ok' | 'answered' | 'refused' | 'timeout' | 'dns' | 'tls' | 'error'; status?: number | null; detail?: string | null }
export interface DockerCheck { installed: boolean; running: boolean; version?: string | null; detail?: string | null }

const realShell = {
  check: (kind: ProviderKind, baseUrl: string, key: string | null, model: string | null) =>
    invoke<{ models: string[] }>('guide_check', { kind, baseUrl, key, model }),
  status: () => invoke<{ kind: ProviderKind; base_url: string; has_key: boolean } | null>('guide_status'),
  call: (body: Record<string, unknown>) => invoke<unknown>('guide_call', { body }),
  forget: () => invoke<void>('guide_forget'),
  address: (url: string) => invoke<AddressCheck>('guide_check_address', { url }),
  docker: () => invoke<DockerCheck>('guide_check_docker'),
  server: serverCall,
};
export type Shell = typeof realShell;
export let shell: Shell = realShell;
/** Development only (src/dev/*Preview.tsx): a made-up shell and server, to look at the screens without either. */
export function previewShell(fake: Partial<Shell>) { shell = { ...realShell, ...fake }; }
export const errText = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message ?? String(e));
export async function openLink(url: string) {
  try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); } catch { window.open(url, '_blank', 'noopener'); }
}
