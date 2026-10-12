import { nativePlatform } from './runtime';

/** Register the hosted web edition's complete offline cache. */
export async function registerOfflineApp(): Promise<void> {
  if (!import.meta.env.PROD || nativePlatform() !== null) return;
  if (!('serviceWorker' in navigator)) return;

  const base = import.meta.env.BASE_URL;
  await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
}
