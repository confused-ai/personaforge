/**
 * Tests for the pure primitives in `personaforge/serve`:
 *   - JWT sign / verify round-trip
 *   - Prometheus registry (register / record / increment / render / reset)
 *   - SSE encoding
 *
 * No sockets, no HTTP server — these are self-contained functions.
 */

import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/serve/auth.js';
import { PrometheusRegistry } from '../src/serve/prometheus.js';
import { encodeSSE } from '../src/serve/data-stream.js';

describe('signJwt / verifyJwt', () => {
    const SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

    it('round-trips a payload', () => {
        const token = signJwt({ sub: 'u1', tenantId: 't1', roles: ['admin'] }, SECRET, 60);
        const payload = verifyJwt(token, SECRET);
        expect(payload.sub).toBe('u1');
        expect(payload.tenantId).toBe('t1');
        expect(payload.roles).toEqual(['admin']);
        expect(payload.iat).toBeGreaterThan(0);
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('rejects tokens signed with a different secret', () => {
        const token = signJwt({ sub: 'u1', tenantId: 't1', roles: [] }, SECRET, 60);
        expect(() => verifyJwt(token, 'wrong-secret')).toThrow();
    });

    it('rejects malformed tokens', () => {
        expect(() => verifyJwt('not.a.jwt', SECRET)).toThrow();
        expect(() => verifyJwt('only-two.parts', SECRET)).toThrow();
    });

    it('rejects expired tokens', () => {
        // Sign with -1s TTL → immediately expired.
        const token = signJwt({ sub: 'u1', tenantId: 't1', roles: [] }, SECRET, -1);
        expect(() => verifyJwt(token, SECRET)).toThrow();
    });
});

describe('PrometheusRegistry', () => {
    it('registers a metric and renders it in exposition format', () => {
        const reg = new PrometheusRegistry();
        reg.register({
            name: 'test.counter',
            type: 'counter',
            help: 'a test counter',
            unit: 'count',
            samples: [],
        });
        reg.increment('test.counter', 3, { route: '/x' });
        const output = reg.render({ prefix: 'pf_' });
        expect(output).toContain('# TYPE pf_test_counter counter');
        expect(output).toContain('pf_test_counter{route="/x"} 3');
    });

    it('increment accumulates on repeated calls with matching labels', () => {
        const reg = new PrometheusRegistry();
        reg.register({ name: 'c', type: 'counter', help: '', unit: 'count', samples: [] });
        reg.increment('c', 2, { k: 'a' });
        reg.increment('c', 5, { k: 'a' });
        reg.increment('c', 1, { k: 'b' });
        const out = reg.render({ includeMetadata: false });
        expect(out).toContain('personaforge_c{k="a"} 7');
        expect(out).toContain('personaforge_c{k="b"} 1');
    });

    it('record overwrites the sample with matching labels', () => {
        const reg = new PrometheusRegistry();
        reg.register({ name: 'g', type: 'gauge', help: '', unit: '1', samples: [] });
        reg.record('g', 10, { host: 'a' });
        reg.record('g', 42, { host: 'a' });
        const out = reg.render({ includeMetadata: false });
        expect(out).toContain('personaforge_g{host="a"} 42');
        expect(out).not.toContain('personaforge_g{host="a"} 10');
    });

    it('reset() clears samples but keeps metric definitions', () => {
        const reg = new PrometheusRegistry();
        reg.register({ name: 'r', type: 'counter', help: '', unit: 'count', samples: [] });
        reg.increment('r', 1);
        reg.reset();
        const out = reg.render();
        // metric definition still present (TYPE line), but no sample line
        expect(out).toContain('# TYPE personaforge_r counter');
        expect(out).not.toMatch(/personaforge_r\{\} 1/);
    });

    it('ignores writes to unregistered metrics', () => {
        const reg = new PrometheusRegistry();
        reg.increment('never-registered', 5);
        const out = reg.render();
        expect(out).not.toContain('never-registered');
    });
});

describe('encodeSSE', () => {
    it('formats a StreamChunk as SSE data frame', () => {
        // Minimal StreamChunk — the run-finish variant carries an AgentRunResult.
        const frame = encodeSSE({
            type: 'run-finish',
            run: {
                text: 'hello',
                messages: [],
                steps: 1,
                finishReason: 'stop',
            },
        } as unknown as import('../src/create-agent/types.js').StreamChunk);
        expect(frame.startsWith('data: ')).toBe(true);
        expect(frame.endsWith('\n\n')).toBe(true);
        const payload = JSON.parse(frame.slice('data: '.length, -2));
        expect(payload.type).toBe('run-finish');
    });
});
