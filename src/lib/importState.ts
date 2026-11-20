// What the import screen has found so far, in words and numbers only, for the guide's import_sources tool
// (src/lib/guide.ts). The screen writes it as it goes; the guide reads it. No content, no keys, no client names.
export interface ImportSnapshot {
  phase: 'finding' | 'ready' | 'review' | 'importing' | 'done' | 'not-admin' | 'no-store';
  /** Each Claude Code home on this computer, as the screen describes it. */
  homes: { title: string; account: string | null; profiles: string | null; holds: string; lastUsed: string | null; included: boolean }[];
  /** Each claude.ai export added. */
  claudeAi: { account: string; chats: number; emptyChats: number; memories: number; cantKeepYet: number; addedFrom: string[]; included: boolean }[];
  /** Skills and the like: to bring, held back on this computer (secret or client), unreadable. */
  extensions: { toBring: number; heldForSecret: number; heldForClient: number; unreadable: number } | null;
  /** The suggested plan from the server. */
  plan: { projects: number; newProjects: number; clientProjects: number; conversationsNew: number; conversationsAlreadyHere: number } | null;
  totals: { found: number; toBring: number } | null;
  canScanThisComputer: boolean;
  error: string | null;
}

let snap: ImportSnapshot | null = null;
export const setImportSnapshot = (s: ImportSnapshot | null) => { snap = s; };
export const importSnapshot = () => snap;
