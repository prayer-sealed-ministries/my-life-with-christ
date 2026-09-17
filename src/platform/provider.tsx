/**
 * The platform, supplied to the tree.
 *
 * One provider at the root. A view takes the single capability it needs; tests
 * pass fakes through this same door, which is how a port can be asserted from
 * the product surface rather than only in isolation — a perfectly tested file
 * saver that no screen calls is not progress.
 */

import type { ReactNode } from 'react';

import { PlatformContext, platformForEdition } from './context';
import type { Platform } from './ports';

export function PlatformProvider({
  children,
  platform,
}: {
  children: ReactNode;
  platform?: Platform;
}) {
  const chosen = platform ?? platformForEdition();
  return <PlatformContext.Provider value={chosen}>{children}</PlatformContext.Provider>;
}
