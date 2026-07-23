/**
 * Production HTTP runtime: stateless app + session-scoped agent APIs.
 *
 * `personaforge/runtime` is the batteries-included HTTP layer — an Express-style
 * factory (`createHttpService` / `listenService`), OpenAPI generation, admin API,
 * JWT / RBAC middleware, and background job wiring. It builds on the low-level
 * primitives in `personaforge/serve` (SSE stream helpers, WebSocket transport,
 * routing utilities). Both modules are supported; import from whichever level of
 * abstraction you need.
 */

export { createHttpService, listenService } from './server.js';
export { getRuntimeOpenApiJson } from './openapi.js';
export type { CreateHttpServiceOptions, HttpService, RequestAuditEntry, RegisteredAgent } from './types.js';
export {
    createAuthMiddleware,
    apiKeyAuth,
    bearerAuth,
} from './auth.js';
export type {
    AuthMiddlewareOptions,
    AuthResult,
    AuthContext,
    ApiKeyStrategyOptions,
    BearerStrategyOptions,
    BasicStrategyOptions,
    CustomStrategyOptions,
} from './auth.js';

// JWT RBAC
export { jwtAuth, verifyJwtHs256, verifyJwtAsymmetric, hasRole } from './jwt-rbac.js';
export type { JwtAuthOptions, JwtPayload } from './jwt-rbac.js';

// Admin API
export type { AdminApiOptions, AdminStats } from './admin.js';

// WebSocket transport
export { attachWebSocketTransport } from './ws-transport.js';
