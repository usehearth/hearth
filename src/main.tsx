import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Web build only (the desktop app has no need): install as an app on phones and desktops. Production builds only, so
// development never serves a cached copy.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not installable here */ }); });
}
