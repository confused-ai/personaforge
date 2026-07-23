/**
 * @personaforge/voice — Voice provider module
 *
 * @experimental This subsystem is newer and not yet semver-stable — its
 * provider and streaming APIs may change in a minor release.
 */
export {
    OpenAIVoiceProvider,
    ElevenLabsVoiceProvider,
    createVoiceProvider,
} from './voice-provider.js';

export type {
    VoiceConfig,
    VoiceProvider,
    TTSResult,
    STTResult,
    OpenAIVoice,
} from './voice-provider.js';

// ── Real-time streaming ──────────────────────────────────────────────────────
export { VoiceStreamSession } from './stream.js';
export type {
    VoiceStreamConfig,
    VoiceStreamEvent,
    VoiceStreamEventType,
} from './stream.js';
