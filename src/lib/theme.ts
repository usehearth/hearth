import { useEffect, useState, useSyncExternalStore } from 'react';

const KEY = 'hearth.theme';
export type ThemeMode = 'system' | 'light' | 'dark';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');
const read = (): ThemeMode => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
let mode: ThemeMode = typeof window === 'undefined' ? 'system' : read();
const listeners = new Set<() => void>();
export function setThemeMode(m: ThemeMode) {
  mode = m;
  try { if (m === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, m); } catch { /* */ }
  for (const l of listeners) l();
}
export const useThemeMode = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => mode);

/** Follows the system until the user picks; the choice is remembered on this device. */
export function useTheme() {
  const m = useThemeMode();
  const [sysDark, setSysDark] = useState(() => mq().matches);
  useEffect(() => { const q = mq(); const on = () => setSysDark(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, []);
  const dark = m === 'system' ? sysDark : m === 'dark';
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  const toggle = () => setThemeMode(dark ? 'light' : 'dark');
  return { dark, toggle };
}
