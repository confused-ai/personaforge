---
title: "Runbook: Voice"
description: "Operational runbook for personaforge/voice — import, run, verify, recover. 12 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Voice

> Auto-generated from `./dist/voice.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/voice`  ·  **Public symbols:** 12  ·  **Guide:** [/guide/voice](../guide/voice.md)

## What it is
`personaforge/voice` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createVoiceProvider, OpenAIVoiceProvider, ElevenLabsVoiceProvider } from 'personaforge/voice';
```

## Public API surface
- **Factories / functions** — `createVoiceProvider`
- **Classes** — `OpenAIVoiceProvider`, `ElevenLabsVoiceProvider`, `VoiceStreamSession`
- **Interfaces** — `VoiceConfig`, `TTSResult`, `STTResult`, `VoiceProvider`, `VoiceStreamConfig`, `VoiceStreamEvent`
- **Types** — `OpenAIVoice`, `VoiceStreamEventType`

## Minimal use
```ts
import { createVoiceProvider, OpenAIVoiceProvider, ElevenLabsVoiceProvider } from 'personaforge/voice';

// `createVoiceProvider` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createVoiceProvider(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/voice` with no missing-module error.
- Runtime: `node -e "import('personaforge/voice').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/voice](../guide/voice.md).

## Common failures
- `Cannot find module 'personaforge/voice'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/voice](../guide/voice.md)
