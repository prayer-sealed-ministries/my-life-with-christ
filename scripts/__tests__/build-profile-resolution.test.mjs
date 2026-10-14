import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * One canonical answer to "which profile is this build?".
 *
 * `vite.config.ts` used to decide source maps with its own defaulting
 * expression, `(process.env.DATA_PROFILE ?? 'full') === 'full'`, while the
 * data-profile plugin defaulted the same unset variable to `public`. A bare
 * `npm run build` therefore announced `DATA_PROFILE=public` and emitted 112
 * source maps, because the two readers disagreed about what unset meant — and
 * the value the sourcemap branch defaulted to was `full`, the retired licensed
 * compilation profile that `resolveProfile` refuses by name.
 *
 * These load the real config, so they answer what a build would actually do.
 */

async function loadConfig(profile) {
  const previous = process.env.DATA_PROFILE;
  if (profile === undefined) delete process.env.DATA_PROFILE;
  else process.env.DATA_PROFILE = profile;

  try {
    // The profile is resolved at module scope, so the module has to be
    // re-evaluated for each environment rather than reused from cache.
    vi.resetModules();
    const module = await import('../../vite.config.ts');
    return module.default;
  } finally {
    if (previous === undefined) delete process.env.DATA_PROFILE;
    else process.env.DATA_PROFILE = previous;
  }
}

/** What the plugin was handed, read back off the built plugin list. */
function profileFromPlugins(config) {
  const plugin = config.plugins.flat(Infinity).find((entry) => entry?.name === 'journey:data-profile');
  // The plugin publishes its answer through the define it contributes, which is
  // what the application actually reads.
  return JSON.parse(plugin.config().define.__DATA_PROFILE__);
}

afterEach(() => {
  vi.resetModules();
});

describe('DATA_PROFILE resolution in the build config', () => {
  // Requirement A.
  it('resolves an unset DATA_PROFILE to the documented default, public', async () => {
    const config = await loadConfig(undefined);
    expect(profileFromPlugins(config)).toBe('public');
  });

  // Requirement B: the default build and the explicit public build must not
  // differ in anything that bears on publishability.
  it('makes the default build identical to an explicit public build', async () => {
    const byDefault = await loadConfig(undefined);
    const explicit = await loadConfig('public');

    expect(profileFromPlugins(byDefault)).toBe(profileFromPlugins(explicit));
    expect(byDefault.build.sourcemap).toBe(explicit.build.sourcemap);
    expect(byDefault.define.__DEBUG_TOOLS__).toBe(explicit.define.__DEBUG_TOOLS__);
  });

  // Requirement C.
  it('emits no source maps for public', async () => {
    const config = await loadConfig('public');
    expect(config.build.sourcemap).toBe(false);
  });

  // Requirement D.
  it('emits no source maps for refs-only, and leaves that profile otherwise alone', async () => {
    const config = await loadConfig('refs-only');
    expect(config.build.sourcemap).toBe(false);
    expect(profileFromPlugins(config)).toBe('refs-only');
  });

  it('emits no source maps whatever the profile, including unset', async () => {
    for (const profile of [undefined, 'public', 'refs-only']) {
      const config = await loadConfig(profile);
      expect(config.build.sourcemap, `profile ${profile ?? '(unset)'}`).toBe(false);
    }
  });

  /*
   * The value the old expression defaulted to.
   *
   * `full` read a licensed third-party compilation and is gone. A build that
   * still asks for it must stop, not quietly produce something else — and
   * certainly not become the one configuration that turns source maps on.
   */
  it('refuses the retired licensed profile at config time', async () => {
    await expect(loadConfig('full')).rejects.toThrow(/must be one of/);
  });

  it('refuses an unknown profile rather than guessing', async () => {
    await expect(loadConfig('publik')).rejects.toThrow(/must be one of/);
  });
});
