/**
 * Test fixtures and utilities
 *
 * Provides common test data and helper functions
 */

/**
 * Create test agent instructions
 */
export function createTestInstructions(): string {
    return 'You are a helpful test assistant. Answer concisely.';
}

/**
 * Create test user ID
 */
export function createTestUserId(): string {
    return `test-user-${Date.now()}`;
}

/**
 * Create test session ID
 */
export function createTestSessionId(): string {
    return `test-session-${Date.now()}`;
}

/**
 * Wait for a condition to be true (useful for async testing)
 */
export async function waitFor(
    condition: () => boolean,
    timeout = 5000,
    interval = 100
): Promise<void> {
    const startTime = Date.now();

    while (!condition()) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Timeout waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}

/**
 * Mock tool response
 */
export interface MockToolResponse {
    name: string;
    input: Record<string, unknown>;
    output: unknown;
}

/**
 * Create a mock tool response
 */
export function createMockToolResponse(
    name: string,
    input: Record<string, unknown>,
    output: unknown
): MockToolResponse {
    return { name, input, output };
}

/**
 * Sleep for a given number of milliseconds. Rejects early when `signal` aborts.
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Sleep aborted.');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new Error('Sleep aborted.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Assert two values are equal (throws if not)
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
        throw new Error(
            `Assertion failed: ${message || ''}\n` +
            `Expected: ${JSON.stringify(expected)}\n` +
            `Actual: ${JSON.stringify(actual)}`
        );
    }
}

/**
 * Assert a value is not null
 */
export function assertNotNull<T>(value: T | null | undefined, message?: string): asserts value is T {
    if (value == null) {
        throw new Error(`Assertion failed: ${message || 'Value should not be null'}`);
    }
}

/**
 * Create test metadata
 */
export function createTestMetadata(): Record<string, unknown> {
    return {
        testId: Date.now(),
        timestamp: new Date().toISOString(),
    };
}
