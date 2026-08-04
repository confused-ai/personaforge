/**
 * Hermetic unit tests for the `checkVersion` compat guard (src/shared).
 */

import { describe, it, expect } from 'vitest';
import { checkVersion } from '../src/shared/version-guard.js';
import { VERSION } from '../src/shared/version.js';

describe('checkVersion', () => {
    it('passes when current satisfies a bare minimum version', () => {
        const r = checkVersion('2.0.0', { current: '2.2.5' });
        expect(r.ok).toBe(true);
        expect(r.current).toBe('2.2.5');
        expect(r.required).toBe('>=2.0.0');
    });

    it('fails when current is below the minimum', () => {
        const r = checkVersion('3.0.0', { current: '2.2.5' });
        expect(r.ok).toBe(false);
    });

    it('supports semver ranges', () => {
        expect(checkVersion('^2.1.0', { current: '2.2.5' }).ok).toBe(true);
        expect(checkVersion('^2.1.0', { current: '3.0.0' }).ok).toBe(false);
        expect(checkVersion('>=2.0.0 <3.0.0', { current: '2.9.0' }).ok).toBe(true);
        expect(checkVersion('>=2.0.0 <3.0.0', { current: '3.0.0' }).ok).toBe(false);
    });

    it('treats a prerelease below a stable minimum as a miss, above as a hit', () => {
        // A prerelease sorts below its stable release, so 2.0.0-beta.1 < 2.0.0.
        expect(checkVersion('2.0.0', { current: '2.0.0-beta.1' }).ok).toBe(false);
        // But it satisfies a range that includes prereleases of a higher version.
        expect(checkVersion('>=2.0.0-beta.0', { current: '2.0.0-beta.1' }).ok).toBe(true);
        expect(checkVersion('>=3.0.0-0', { current: '3.0.0-rc.1' }).ok).toBe(true);
    });

    it('defaults current to the package VERSION', () => {
        const r = checkVersion(VERSION);
        expect(r.ok).toBe(true);
        expect(r.current).toBe(VERSION);
    });

    it('returns the required range in the result', () => {
        const r = checkVersion('2.1.0', { current: '2.2.5' });
        expect(r.required).toBe('>=2.1.0');
    });
});
