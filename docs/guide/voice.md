---
title: Voice
description: Add text-to-speech (TTS) and speech-to-text (STT) to agents. OpenAIVoiceProvider, ElevenLabsVoiceProvider, VoiceStreamSession for real-time audio streaming.
outline: [2, 3]
---

# Voice

The voice module provides TTS/STT adapters and a real-time streaming session that wires together speech input → agent reasoning → spoken output.

```ts
import {
  OpenAIVoiceProvider,
  ElevenLabsVoiceProvider,
  createVoiceProvider,
  VoiceStreamSession,
} from 'personaforge';
```

---

## Text-to-Speech (TTS)

```ts
import { OpenAIVoiceProvider } from 'personaforge';

const voice = new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY });

const result = await voice.textToSpeech('Hello, how can I help you today?', {
  voiceId: 'nova',   // 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  model: 'tts-1-hd',
  speed: 1.0,        // 0.25–4.0
});

// result.audio     — ArrayBuffer
// result.format    — 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
// result.durationSeconds
// result.characterCount
```

---

## Speech-to-Text (STT)

```ts
const audioBuffer: ArrayBuffer = await readAudioFile('./question.mp3');

const transcript = await voice.speechToText(audioBuffer, { language: 'en' });
// transcript.text        — transcribed string
// transcript.language    — detected language
// transcript.confidence  — 0–1
// transcript.durationSeconds
```

---

## ElevenLabs provider

```ts
import { ElevenLabsVoiceProvider } from 'personaforge';

const voice = new ElevenLabsVoiceProvider({
  apiKey: process.env.ELEVENLABS_API_KEY!,
});

const result = await voice.textToSpeech('Welcome back!', {
  voiceId: 'rachel',  // ElevenLabs voice ID
});
```

---

## `createVoiceProvider` factory

```ts
import { createVoiceProvider } from 'personaforge';

const voice = createVoiceProvider({
  provider: process.env.VOICE_PROVIDER as 'openai' | 'elevenlabs',
  apiKey: process.env.VOICE_API_KEY!,
  voiceId: 'nova',
  model: 'tts-1',
});
```

---

## Real-time voice streaming

`VoiceStreamSession` connects a microphone stream to an agent and streams synthesised audio back:

```ts
import { OpenAIVoiceProvider, VoiceStreamSession } from 'personaforge';
import { createAgent } from 'personaforge';

const voiceProvider = new OpenAIVoiceProvider();
const agent = createAgent({
  name: 'voice-assistant',
  instructions: 'You are a helpful voice assistant. Be concise.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const session = new VoiceStreamSession({
  stt: voiceProvider,
  tts: voiceProvider,
  run: async (text) => {
    const result = await agent.run(text);
    return result.text;
  },
  voiceId: 'nova',
  silenceThresholdMs: 800,   // ms of silence to trigger STT
});

// Push raw PCM audio chunks in real time (from microphone, WebSocket, etc.)
microphone.on('data', (chunk) => session.pushChunk(chunk));

// Consume events
for await (const event of session.events()) {
  switch (event.type) {
    case 'transcript':
      console.log('User said:', event.text);
      break;
    case 'text_delta':
      process.stdout.write(event.delta ?? '');
      break;
    case 'audio':
      speaker.write(event.chunk);  // play synthesised audio
      break;
    case 'agent_end':
      console.log('Agent finished speaking');
      break;
    case 'error':
      console.error('Voice error:', event.error);
      break;
  }
}

await session.end();
```

### `VoiceStreamEvent` types

| `type` | Fields | Description |
|---|---|---|
| `transcript` | `text` | STT result from user speech |
| `agent_start` | — | Agent processing began |
| `text_delta` | `delta` | One token from agent response |
| `audio` | `chunk` (Uint8Array) | TTS audio chunk (MP3) |
| `agent_end` | — | Agent finished responding |
| `error` | `error` | Session-level error |

---

## `VoiceProvider` interface

Implement this to add any TTS/STT backend:

```ts
interface VoiceProvider {
  textToSpeech(text: string, options?: Partial<VoiceConfig>): Promise<TTSResult>;
  speechToText?(audio: ArrayBuffer | Blob, options?: { language?: string }): Promise<STTResult>;
  listVoices?(): Promise<Array<{ id: string; name: string; preview_url?: string }>>;
}
```

---

## Where to go next

- [Vision](./vision) — image and multimodal inputs.
- [WebSocket](./websocket) — realtime transport for voice sessions.
- [Hooks](./hooks) — lifecycle hooks for monitoring speech latency.
