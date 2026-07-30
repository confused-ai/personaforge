/**
 * Hermetic coverage for src/shared — try-import, errors, debug-logger, telemetry, version.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryImport } from '../src/shared/try-import.js';
import {
    ErrorCode,
    AgentError,
    LLMError,
    ToolExecutionError,
    GuardrailError,
    TimeoutError,
    CancellationError,
    ConfigError,
    SessionError,
    PermissionError,
    ToolNotAuthorizedError,
} from '../src/shared/errors.js';
import {
    DebugLogger,
    createDebugLogger,
    createNoopLogger,
    setGlobalDebug,
    isGlobalDebugEnabled,
} from '../src/shared/debug-logger.js';
import { VERSION } from '../src/shared/version.js';

describe('shared/try-import', () => {
    it('returns module for installed specifier', async () => {
        const path = await tryImport<{ join: (...parts: string[]) => string }>('node:path');
        expect(path).toBeTruthy();
        expect(typeof (path as { join: (...a: string[]) => string }).join).toBe('function');
    });

    it('returns null for missing package', async () => {
        expect(await tryImport('pkg-that-does-not-exist-xyz-999')).toBeNull();
    });
});

describe('shared/errors', () => {
    it('ErrorCode constants', () => {
        expect(ErrorCode.AGENT_ERROR).toBe('AGENT_ERROR');
        expect(ErrorCode.BUDGET_EXCEEDED).toBe('BUDGET_EXCEEDED');
        expect(ErrorCode.CIRCUIT_OPEN).toBe('CIRCUIT_OPEN');
    });

    it('AgentError defaults and toJSON', () => {
        const e = new AgentError('msg');
        expect(e.code).toBe(ErrorCode.AGENT_ERROR);
        expect(e.retryable).toBe(false);
        expect(e.cause).toBeUndefined();
        expect(e.context).toBeUndefined();
        expect(e.toJSON()).toMatchObject({ name: 'AgentError', message: 'msg', code: 'AGENT_ERROR' });

        const cause = new Error('root');
        const e2 = new AgentError('m2', {
            code: ErrorCode.MAX_STEPS,
            retryable: true,
            cause,
            context: { step: 3 },
        });
        expect(e2.code).toBe(ErrorCode.MAX_STEPS);
        expect(e2.retryable).toBe(true);
        expect(e2.cause).toBe(cause);
        expect(e2.context).toEqual({ step: 3 });
        expect(e2.toJSON().cause).toBe('root');
    });

    it('specialized error subclasses', () => {
        expect(new LLMError('l').retryable).toBe(true);
        expect(new LLMError('l', { retryable: false }).retryable).toBe(false);

        const te = new ToolExecutionError('t', {
            toolName: 'search',
            code: ErrorCode.TOOL_VALIDATION_ERROR,
        });
        expect(te.toolName).toBe('search');
        expect(te.code).toBe(ErrorCode.TOOL_VALIDATION_ERROR);
        expect(new ToolExecutionError('plain').toolName).toBeUndefined();

        const ge = new GuardrailError('g', { rule: 'pii' });
        expect(ge.rule).toBe('pii');
        expect(new GuardrailError('g2').rule).toBeUndefined();

        const to = new TimeoutError('timeout', { timeoutMs: 10 });
        expect(to.timeoutMs).toBe(10);
        expect(to.retryable).toBe(true);
        expect(new TimeoutError('t2').timeoutMs).toBeUndefined();

        expect(new CancellationError().code).toBe(ErrorCode.CANCELLED);
        expect(new CancellationError('stop', { context: { id: 1 } }).message).toBe('stop');

        expect(new ConfigError('cfg').code).toBe(ErrorCode.CONFIG_ERROR);
        expect(new SessionError('sess').code).toBe(ErrorCode.SESSION_ERROR);
        expect(new PermissionError('no').code).toBe(ErrorCode.PERMISSION_DENIED);

        const tna = new ToolNotAuthorizedError('tool-x', { tenantId: 't1', context: { extra: true } });
        expect(tna.toolName).toBe('tool-x');
        expect(tna.context).toMatchObject({ toolName: 'tool-x', tenantId: 't1', extra: true });
        expect(new ToolNotAuthorizedError('y').context).toMatchObject({ toolName: 'y' });
    });
});

describe('shared/debug-logger', () => {
    beforeEach(() => {
        setGlobalDebug(false);
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setGlobalDebug(false);
    });

    it('string config starts disabled; enabled logs debug', () => {
        const off = new DebugLogger('Comp');
        expect(off.isEnabled()).toBe(false);
        off.debug('nope');
        expect(console.debug).not.toHaveBeenCalled();

        const on = new DebugLogger({ component: 'Comp', enabled: true });
        expect(on.isEnabled()).toBe(true);
        on.debug('hi', {}, { a: 1 });
        expect(console.debug).toHaveBeenCalled();
    });

    it('info/warn/error/fatal always log', () => {
        const log = new DebugLogger({ component: 'X', enabled: false });
        log.info('i', {}, { k: 1 });
        log.warn('w');
        log.error('e');
        log.fatal('f');
        expect(console.info).toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('child inherits enabled and merges context', () => {
        const parent = new DebugLogger({ component: 'P', enabled: true, context: { userId: 'u' } });
        const child = parent.child({ sessionId: 's' });
        expect(child.isEnabled()).toBe(true);
        child.debug('c');
        expect(console.debug).toHaveBeenCalled();
    });

    it('logStart/Complete/Step/StateChange/Data honor enabled flag', () => {
        const off = new DebugLogger({ component: 'O', enabled: false });
        off.logStart('op');
        off.logComplete('op', 1);
        off.logStep('s', 1, 2);
        off.logStateChange('e', 'a', 'b');
        off.logData('d', { x: 1 });
        expect(console.debug).not.toHaveBeenCalled();

        const on = new DebugLogger({ component: 'O', enabled: true });
        on.logStart('op', { a: 1 });
        on.logComplete('op', 5, { b: 2 });
        on.logComplete('op2');
        on.logStep('s', 1, 3);
        on.logStateChange('ent', 'idle', 'run');
        on.logData('label', 'short');
        on.logData('big', 'x'.repeat(250));
        on.logData('obj', { nested: true });
        expect(console.debug).toHaveBeenCalled();
    });

    it('formatMetadata handles empty and circular metadata', () => {
        const on = new DebugLogger({ component: 'M', enabled: true });
        on.debug('empty', {}, {});
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        on.debug('circ', {}, circular);
        expect(console.debug).toHaveBeenCalled();
    });

    it('global debug helpers and factories', () => {
        expect(isGlobalDebugEnabled()).toBe(false);
        setGlobalDebug(true);
        expect(isGlobalDebugEnabled()).toBe(true);
        const logger = createDebugLogger('G');
        expect(logger.isEnabled()).toBe(true);
        const forced = createDebugLogger('F', false);
        expect(forced.isEnabled()).toBe(false);

        const noop = createNoopLogger();
        noop.debug('x');
        noop.info('x');
        noop.warn('x');
        noop.error('x');
        noop.fatal('x');
        expect(noop.child({}).debug).toBeTypeOf('function');
    });
});

describe('shared/version', () => {
    it('exports VERSION string', () => {
        expect(typeof VERSION).toBe('string');
        expect(VERSION.length).toBeGreaterThan(0);
    });
});

describe('shared/telemetry', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('isTelemetryEnabled false by default; record no-ops without env', async () => {
        vi.resetModules();
        const mod = await import('../src/shared/telemetry.js');
        expect(mod.isTelemetryEnabled()).toBe(false);
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        mod.recordFrameworkStartup({ version: '1', runtime: 'test' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('posts once when CONFUSED_AI_TELEMETRY=1 and URL set', async () => {
        vi.stubEnv('CONFUSED_AI_TELEMETRY', '1');
        vi.stubEnv('CONFUSED_AI_TELEMETRY_URL', 'https://example.test/telemetry');
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchSpy);
        vi.resetModules();
        const mod = await import('../src/shared/telemetry.js');
        expect(mod.isTelemetryEnabled()).toBe(true);
        mod.recordFrameworkStartup({ version: '9', runtime: 'vitest' });
        mod.recordFrameworkStartup({ version: '9', runtime: 'vitest' });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]![0]).toBe('https://example.test/telemetry');
    });

    it('swallows fetch rejection', async () => {
        vi.stubEnv('CONFUSED_AI_TELEMETRY', '1');
        vi.stubEnv('CONFUSED_AI_TELEMETRY_URL', 'https://example.test/t');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
        vi.resetModules();
        const mod = await import('../src/shared/telemetry.js');
        expect(() => mod.recordFrameworkStartup({ version: '1', runtime: 't' })).not.toThrow();
    });
});
