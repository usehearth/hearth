import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Development only: #preview/<section> shows a Settings section against made-up data (src/dev/Preview.tsx).
// #preview/setup shows first-run setup with a made-up provider and server (src/dev/SetupPreview.tsx).
const Preview = import.meta.env.DEV && location.hash.startsWith('#preview/')
  ? lazy(() => (location.hash === '#preview/setup' ? import('./dev/SetupPreview') : import('./dev/Preview'))) : null;

createRoot(document.getElementById('root')!).render(Preview ? <Suspense><Preview /></Suspense> : <App />);

// Web build only (the desktop app has no need): install as an app on phones and desktops. Production builds only, so
// development never serves a cached copy.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not installable here */ }); });
}
