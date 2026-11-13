// Notifications from the app itself: a turn finished, or something new needs you. Only when this window isn't the one
// being looked at, and only if the owner turned them on (Settings > Appearance). The desktop app uses the OS
// notification centre (Tauri plugin); the web build uses the browser's Notification API.
import { isDesktop } from './servers';

const PREF = 'hearth.notify.v1';

export function notifyPref(): boolean {
  try { return localStorage.getItem(PREF) === 'on'; } catch { return false; }
}

/** Turn notifications on (asks the OS or browser for permission) or off. Resolves to whether they're on. */
export async function setNotifyPref(on: boolean): Promise<boolean> {
  if (on && !(await permission(true))) on = false;
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private mode */ }
  return on;
}

async function permission(ask: boolean): Promise<boolean> {
  if (isDesktop) {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return true;
    return ask ? (await n.requestPermission()) === 'granted' : false;
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return ask && Notification.permission !== 'denied' ? (await Notification.requestPermission()) === 'granted' : false;
}

/** Whether a notification would show now: on, allowed, and the window not in front. */
const wanted = () => notifyPref() && (document.visibilityState !== 'visible' || !document.hasFocus());

const recent = new Map<string, number>();

/** Show a notification (title and a short body). `tag` collapses repeats within a minute. Clicking brings the window forward. */
export async function notify(title: string, body: string, tag?: string, onClick?: () => void) {
  if (!wanted() || !(await permission(false))) return;
  if (tag) {
    const at = recent.get(tag) ?? 0;
    if (Date.now() - at < 60_000) return;
    recent.set(tag, Date.now());
  }
  const text = body.length > 160 ? body.slice(0, 157) + '…' : body;
  if (isDesktop) {
    const n = await import('@tauri-apps/plugin-notification');
    n.sendNotification({ title, body: text });
    return;
  }
  const note = new Notification(title, { body: text, tag, icon: '/logo.svg' });
  note.onclick = () => { window.focus(); onClick?.(); note.close(); };
}
