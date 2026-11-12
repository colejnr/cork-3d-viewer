// CesiumJS is loaded from the jsDelivr CDN (not bundled), so the build stays small.
export const CESIUM_VERSION = '1.121.0';
export const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type C = any;

let pending: Promise<C> | null = null;

export function loadCesium(): Promise<C> {
  const w = window as unknown as { Cesium?: C; CESIUM_BASE_URL?: string };
  if (w.Cesium) return Promise.resolve(w.Cesium);
  if (pending) return pending;
  w.CESIUM_BASE_URL = CESIUM_BASE; // must be set before Cesium.js runs
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = CESIUM_BASE + 'Widgets/widgets.css';
  document.head.appendChild(css);
  pending = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = CESIUM_BASE + 'Cesium.js';
    s.async = true;
    s.onload = () => (w.Cesium ? ok(w.Cesium) : fail(new Error('Cesium did not load')));
    s.onerror = () => fail(new Error('Could not download Cesium'));
    document.head.appendChild(s);
  });
  return pending;
}
