/**
 * The application version, from the one place that defines it.
 *
 * `package.json` is the source; `vite.config.ts` injects it. A version typed
 * into a second file drifts the first time someone bumps only one of them, and
 * a version that lies is worse than one that is absent.
 *
 * Falls back outside a Vite build — unit tests import views directly — so a
 * missing define shows as an honest placeholder rather than a crash.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
