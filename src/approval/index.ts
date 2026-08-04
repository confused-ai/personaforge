/**
 * @personaforge/approval — human-in-the-loop agent approval.
 *
 * Suspends a tool call before it executes (requireApproval / requireToolApproval)
 * or lets a tool self-suspend during execution (`context.agent.suspend(...)`),
 * persists the pending run, and exposes approve/decline/resume flows.
 */

export * from './signals.js';
export * from './store.js';
