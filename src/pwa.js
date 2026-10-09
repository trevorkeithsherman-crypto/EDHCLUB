// Install-as-app + fullscreen helpers shared by every page.
let deferred = null;
const listeners = new Set();
export const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
export function canInstall() { return !!deferred || (isIOS() && !isStandalone()); }
export function onInstallable(fn) { listeners.add(fn); fn(canInstall()); return () => listeners.delete(fn); }
export async function install() {
  if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; listeners.forEach((f) => f(canInstall())); return r.outcome === 'accepted' ? 'installed' : 'dismissed'; }
  if (isIOS()) return 'ios';
  return 'unavailable';
}
export function registerSW() {
  if (!('serviceWorker' in navigator) || navigator.webdriver || (location.hostname === 'localhost' && location.port === '5173')) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f(true)); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f(false)); });

export const fullscreenOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export async function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (fullscreenOn()) { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); return false; }
    await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' }); return true;
  } catch { return null; }
}
export const fullscreenSupported = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
