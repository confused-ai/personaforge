/**
 * Version compatibility guard — assert that the running framework version
 * satisfies a minimum (or range) before using an experimental/breaking surface.
 *
 * ```ts
 * import { checkVersion } from 'personaforge';
 * const { ok, current, required } = checkVersion('2.0.0');
 * if (!ok) throw new Error(`personaforge ${required} required, have ${current}`);
 * ```
 */

import semver from 'semver';
import { VERSION } from './version.js';

export interface CheckVersionOptions {
    /** The running framework version. Defaults to the package `VERSION`. */
    current?: string;
}

export interface CheckVersionResult {
    ok: boolean;
    /** The version in use. */
    current: string;
    /** The minimum version (or range) that was required. */
    required: string;
}

/**
 * Return whether `current` satisfies the given semver requirement. The
 * requirement may be a bare minimum (`'2.0.0'`, meaning `>=2.0.0`) or any
 * semver range (`'^2.1.0'`, `'>=2.0.0 <3.0.0'`).
 */
export function checkVersion(required: string, options: CheckVersionOptions = {}): CheckVersionResult {
    const current = options.current ?? VERSION;
    // Bare versions read as "at least this version".
    const requirement = semver.valid(required) ? `>=${required}` : required;
    const ok = semver.satisfies(current, requirement, { includePrerelease: true });
    return { ok, current, required: requirement };
}
