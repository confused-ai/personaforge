/**
 * Graceful shutdown utilities for Node.js HTTP servers.
 *
 * Handles SIGTERM + SIGINT, drains in-flight requests, runs cleanup
 * hooks (close DB connections, flush metrics, etc.), and force-exits
 * after a configurable deadline.
 *
 * @module
 */

type CleanupFn = () => Promise<void>;

interface ServerLike {
  close(callback?: (err?: Error) => void): void;
}

/**
 * Register graceful shutdown handlers for an HTTP server.
 *
 * On SIGTERM or SIGINT:
 *  1. Stops accepting new connections
 *  2. Runs all `cleanups` in parallel (with `Promise.allSettled`)
 *  3. Exits with code 0
 *
 * If the process has not exited within `timeoutMs`, it force-exits with code 1.
 *
 * @example
 * ```ts
 * import http from 'node:http';
 * import { setupGracefulShutdown } from './lifecycle.js';
 *
 * const server = http.createServer(app);
 * server.listen(3000);
 *
 * setupGracefulShutdown(server, [
 *   () => redisClient.quit(),
 *   () => dbPool.end(),
 * ]);
 * ```
 */
export function setupGracefulShutdown(
  server: ServerLike,
  cleanups: CleanupFn[] = [],
  timeoutMs = 30_000,
): void {
  let isShuttingDown = false;

  const shutdown = (signal: string): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;

     
    console.warn(`[personaforge] ${signal} received — starting graceful shutdown`);

    // Force-exit deadline
    const forceExit = setTimeout(() => {
      console.error(`[personaforge] Graceful shutdown timed out after ${String(timeoutMs)}ms — forcing exit`);
      process.exit(1);
    }, timeoutMs);
    // Don't let this timer keep the process alive if everything finishes cleanly
    if (typeof forceExit.unref === 'function') forceExit.unref();

    server.close((): void => {
      void Promise.allSettled(cleanups.map((fn) => fn())).then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      });
    });
  };

  process.once('SIGTERM', () => { shutdown('SIGTERM'); });
  process.once('SIGINT', () => { shutdown('SIGINT'); });
}

/**
 * Create a cleanup function that closes a resource on shutdown.
 * Useful when wrapping resources that expose a `close()` or `destroy()` method.
 *
 * @example
 * ```ts
 * setupGracefulShutdown(server, [
 *   makeCleanup('Redis', () => redis.quit()),
 *   makeCleanup('DB pool', () => pool.end()),
 * ]);
 * ```
 */
export function makeCleanup(label: string, fn: CleanupFn): CleanupFn {
  return async (): Promise<void> => {
    try {
      await fn();
       
      console.warn(`[personaforge] cleanup '${label}' completed`);
    } catch (e) {
      console.error(`[personaforge] cleanup '${label}' failed`, e);
    }
  };
}
