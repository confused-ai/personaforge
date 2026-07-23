/**
 * personaforge/interfaces — surface adapters for messaging platforms and protocols.
 *
 * ```ts
 * import { SlackInterface, TelegramInterface, A2AInterface, AGUIInterface } from 'personaforge/interfaces';
 * ```
 */

export { BaseInterface } from './base.js';
export type { BaseInterfaceOptions, InterfaceRunResult } from './base.js';

export { SlackInterface } from './slack.js';
export type { SlackInterfaceOptions } from './slack.js';

export { TelegramInterface } from './telegram.js';
export type { TelegramInterfaceOptions } from './telegram.js';

export { A2AInterface } from './a2a.js';
export type { A2AInterfaceOptions, A2AAgentCard } from './a2a.js';

export { AGUIInterface } from './ag-ui.js';
export type { AGUIInterfaceOptions } from './ag-ui.js';
