---
title: "Runbook: Video"
description: "Operational runbook for personaforge/video — import, run, verify, recover. 2 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Video

> Auto-generated from `./dist/video.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/video`  ·  **Public symbols:** 2  ·  **Guide:** [/guide/video](../guide/video.md)

## What it is
`personaforge/video` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { VideoOrchestrator } from 'personaforge/video';
```

## Public API surface
- **Classes** — `VideoOrchestrator`
- **Interfaces** — `VideoGenerationResult`

## Minimal use
Real example from the video guide:

```ts
import { tool, createAgent } from 'personaforge';
import { VideoOrchestrator } from 'personaforge';
import { z } from 'zod';

const orchestrator = new VideoOrchestrator();

const generateVideoTool = tool({
  name: 'generate_video_short',
  description: 'Generate a 30-45 second narrated video short on any topic.',
  schema: z.object({
    topic: z.string().describe('Topic or theme for the video'),
  }),
  timeoutMs: 120_000,   // video generation can take up to 2 minutes
  execute: async ({ topic }) => {
    const result = await orchestrator.generateShort(topic);
    if (!result.success) return { error: result.error };
    return { videoPath: result.videoPath, message: 'Video generated successfully.' };
  },
});

const agent = createAgent({
  name: 'video-creator',
  instructions: 'Create short video clips for users on any topic they request.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [generateVideoTool],
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/video` with no missing-module error.
- Runtime: `node -e "import('personaforge/video').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/video](../guide/video.md).

## Common failures
- `Cannot find module 'personaforge/video'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/video](../guide/video.md)
