/**
 * The platform context and the hooks that read it.
 *
 * Separate from the provider component on purpose: a module that exports both
 * components and plain functions breaks React Fast Refresh, and the lint rule
 * says so. Keeping the hooks here — where there is no JSX at all — means a view
 * imports a capability without importing a component.
 */

import { createContext, useContext } from 'react';

import type { Platform } from './ports';
import { webPlatform } from './web';

/**
 * Defaults to the web platform, so anything rendered without a provider — a
 * focused unit test, say — behaves exactly as the application always has.
 */
export const PlatformContext = createContext<Platform>(webPlatform);

/**
 * The whole platform. Prefer the narrow hooks below.
 *
 * Taking the whole object is right for a component that genuinely needs two
 * capabilities; it is wrong as a habit, because it invites passing `platform`
 * around and eventually branching on it.
 */
export function usePlatform(): Platform {
  return useContext(PlatformContext);
}

export const useFileSaver = () => useContext(PlatformContext).files;
export const useFilePicker = () => useContext(PlatformContext).picker;
export const usePrinter = () => useContext(PlatformContext).printer;
export const useUnsavedWorkGuard = () => useContext(PlatformContext).unsavedWork;
