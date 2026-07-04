/**
 * Mastermind module — public barrel
 */

export { Mastermind } from './mastermind.js';
export type {
    MastermindMessage,
    MastermindConfig,
    MastermindStats,
    MastermindLifetimeStats,
    RecentCompressionEvent,
    MastermindRetrieveTool,
} from './mastermind.js';
export { CCRStore, createRetrieveTool } from './ccr.js';
export { CacheAligner } from './cache-aligner.js';
export { detectContentType, routeContent, estimateTokens } from './router.js';
export { smartCrush, crushJsonText } from './smart-crusher.js';
export { compressCode, compressCodeBlocks } from './code-compressor.js';
export { crushLog, crushXml, crushCsv } from './specialized-crushers.js';
export type {
    ContentType,
    CompressionAlgorithm,
    CCREntry,
} from './types.js';
