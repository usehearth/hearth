import { useEffect, useState } from 'react';

const KEY = 'hearth.theme';
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** Follows the system until the user picks; the choice is remembered on this device. */
export function useTheme() {
  const [dark, setDark] = useState(() => (saved() ? saved() === 'dark' : systemDark()));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => { if (!saved()) setDark(mq.matches); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const toggle = () => setDark((d) => { try { localStorage.setItem(KEY, d ? 'light' : 'dark'); } catch { /* */ } return !d; });
  return { dark, toggle };
}
