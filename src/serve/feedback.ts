/**
 * POST /v1/feedback route handler.
 *
 * Mount this with your HTTP server framework of choice:
 *
 * ```ts
 * import { handleFeedback } from 'personaforge/serve';
 * import { InMemoryFeedbackStore } from 'personaforge/production';
 *
 * const store = new InMemoryFeedbackStore();
 *
 * // Node.js http example:
 * if (req.method === 'POST' && req.url === '/v1/feedback') {
 *   const res = await handleFeedback(req, { feedbackStore: store });
 *   reply.status(res.status).json(res.body);
 * }
 *
 * // Or via `createFeedbackRouter(store)` which returns a minimal Fetch-API handler.
 * ```
 */

import { FeedbackEntrySchema } from '../production/index.js';
import type { FeedbackStore } from '../production/index.js';

export interface FeedbackRouteResult {
  /** HTTP status code */
  readonly status: number;
  /** JSON-serialisable body */
  readonly body: unknown;
}

/**
 * Parse + validate a JSON body, then store the feedback entry.
 *
 * @param rawBody - Parsed JSON body (already decoded from request stream).
 * @param store   - `FeedbackStore` instance to persist the entry.
 * @returns       - `{ status, body }` — set these on the HTTP response.
 */
export async function handleFeedback(
  rawBody: unknown,
  store: FeedbackStore,
): Promise<FeedbackRouteResult> {
  const parsed = FeedbackEntrySchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      status: 422,
      body: {
        error:   'ValidationError',
        message: 'Invalid feedback payload',
        issues:  parsed.error.issues,
      },
    };
  }

  const entry = await store.append(parsed.data as Parameters<FeedbackStore['append']>[0]);
  return {
    status: 201,
    body: entry,
  };
}

/**
 * Create a minimal Fetch-API-compatible handler for `POST /v1/feedback`.
 *
 * Works with Bun.serve, Cloudflare Workers, Next.js Route Handlers, etc.
 *
 * ```ts
 * const handler = createFeedbackHandler(store);
 * // In Bun.serve fetch handler:
 * if (url.pathname === '/v1/feedback' && req.method === 'POST') return handler(req);
 * ```
 */
export function createFeedbackHandler(store: FeedbackStore) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await handleFeedback(body, store);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
