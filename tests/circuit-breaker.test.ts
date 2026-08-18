/**
 * Circuit Breaker Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CircuitBreaker,
    CircuitState,
    CircuitOpenError,
    createLLMCircuitBreaker,
} from '../src/production/circuit-breaker.js';

describe('CircuitBreaker', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
        breaker = new CircuitBreaker({
            name: 'test-circuit',
            failureThreshold: 3,
            resetTimeoutMs: 1000,
            failureWindowMs: 5000,
        });
    });

    describe('initial state', () => {
        it('should start in CLOSED state', () => {
            expect(breaker.getState()).toBe(CircuitState.CLOSED);
        });

        it('should allow requests when closed', () => {
            expect(breaker.isAllowed()).toBe(true);
        });

        it('should have zero failure count', () => {
            expect(breaker.getFailureCount()).toBe(0);
        });
    });

    describe('successful execution', () => {
        it('should return success result', async () => {
            const result = await breaker.execute(async () => 'hello');

            expect(result.success).toBe(true);
            expect(result.value).toBe('hello');
            expect(result.state).toBe(CircuitState.CLOSED);
            expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
        });

        it('should remain closed after successful calls', async () => {
            await breaker.execute(async () => 'ok');
            await breaker.execute(async () => 'ok');

            expect(breaker.getState()).toBe(CircuitState.CLOSED);
            expect(breaker.getFailureCount()).toBe(0);
        });
    });

    describe('failure handling', () => {
        it('should count failures', async () => {
            await breaker.execute(async () => { throw new Error('fail'); });

            expect(breaker.getFailureCount()).toBe(1);
            expect(breaker.getState()).toBe(CircuitState.CLOSED);
        });

        it('ages old failures out of the rolling window (O(1) ring)', async () => {
            vi.useFakeTimers();
            try {
                const localBreaker = new CircuitBreaker({
                    name: 'window-aging',
                    failureThreshold: 5,
                    resetTimeoutMs: 60_000,
                    failureWindowMs: 5_000,
                });
                await localBreaker.execute(async () => { throw new Error('fail'); });
                await localBreaker.execute(async () => { throw new Error('fail'); });
                expect(localBreaker.getFailureCount()).toBe(2);
                // Advance beyond the entire failure window — every bucket must age out.
                vi.advanceTimersByTime(6_000);
                expect(localBreaker.getFailureCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('should open after failure threshold', async () => {
            for (let i = 0; i < 3; i++) {
                await breaker.execute(async () => { throw new Error('fail'); });
            }

            expect(breaker.getState()).toBe(CircuitState.OPEN);
        });

        it('should return CircuitOpenError when open', async () => {
            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                await breaker.execute(async () => { throw new Error('fail'); });
            }

            const result = await breaker.execute(async () => 'should not run');

            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(CircuitOpenError);
            expect((result.error as CircuitOpenError).circuitName).toBe('test-circuit');
        });
    });

    describe('recovery', () => {
        it('should transition to HALF_OPEN after reset timeout', async () => {
            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                await breaker.execute(async () => { throw new Error('fail'); });
            }
            expect(breaker.getState()).toBe(CircuitState.OPEN);

            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Check state (should transition on isAllowed check)
            expect(breaker.isAllowed()).toBe(true);
            expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
        });

        it('should close after successful calls in HALF_OPEN', async () => {
            // Create a circuit with 2 success threshold
            breaker = new CircuitBreaker({
                name: 'test-circuit',
                failureThreshold: 1,
                successThreshold: 2,
                resetTimeoutMs: 100,
            });

            // Trip the circuit
            await breaker.execute(async () => { throw new Error('fail'); });
            expect(breaker.getState()).toBe(CircuitState.OPEN);

            // Wait for reset
            await new Promise(resolve => setTimeout(resolve, 150));

            // Successful calls should close it
            await breaker.execute(async () => 'ok');
            expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

            await breaker.execute(async () => 'ok');
            expect(breaker.getState()).toBe(CircuitState.CLOSED);
        });
    });

    describe('reset', () => {
        it('should reset to CLOSED state', async () => {
            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                await breaker.execute(async () => { throw new Error('fail'); });
            }
            expect(breaker.getState()).toBe(CircuitState.OPEN);

            breaker.reset();

            expect(breaker.getState()).toBe(CircuitState.CLOSED);
            expect(breaker.getFailureCount()).toBe(0);
        });
    });

    describe('state change callback', () => {
        it('should call onStateChange when transitioning', async () => {
            const onStateChange = vi.fn();

            breaker = new CircuitBreaker({
                name: 'test-circuit',
                failureThreshold: 1,
                onStateChange,
            });

            await breaker.execute(async () => { throw new Error('fail'); });

            expect(onStateChange).toHaveBeenCalledWith(
                CircuitState.CLOSED,
                CircuitState.OPEN
            );
        });
    });
});

describe('createLLMCircuitBreaker', () => {
    it('should create a circuit breaker with LLM defaults', () => {
        const breaker = createLLMCircuitBreaker('openai');

        expect(breaker.getName()).toBe('openai');
        expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
});
