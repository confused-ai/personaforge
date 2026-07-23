---
title: Video
description: Generate YouTube Shorts and narrated video content with VideoOrchestrator. Combines OpenAI script generation + TTS voiceover + Pexels background footage + FFmpeg stitching.
outline: [2, 3]
---

# Video

The video module provides `VideoOrchestrator` — a pipeline that generates narrated video shorts by combining LLM-written scripts, TTS voiceovers, Pexels stock footage, and FFmpeg composition.

```ts
import { VideoOrchestrator } from 'personaforge';
```

> **Prerequisites**  
> `OPENAI_API_KEY` — script generation and TTS.  
> `PEXELS_API_KEY` — stock background footage. Get one free at [pexels.com/api](https://www.pexels.com/api/).  
> `ffmpeg` must be available (installed automatically via `@ffmpeg-installer/ffmpeg`).

---

## Generate a short video

```ts
import { VideoOrchestrator } from 'personaforge';

const orchestrator = new VideoOrchestrator();

const result = await orchestrator.generateShort('The history of the internet');

if (result.success) {
  console.log('Video saved to:', result.videoPath);
  // result.videoPath — absolute path to the generated MP4 file
} else {
  console.error('Generation failed:', result.error);
}
```

The pipeline runs in order:
1. **Script** — GPT-4o writes a 30–45 second narration script for the topic.
2. **Voiceover** — OpenAI TTS converts the script to MP3 audio.
3. **Background footage** — Pexels API returns stock video clips matching the topic.
4. **Stitch** — FFmpeg layers audio over video, trims to match duration, outputs final MP4.

---

## `VideoGenerationResult`

```ts
interface VideoGenerationResult {
  success: boolean;
  videoPath?: string;   // absolute path to MP4 — present on success
  error?: string;       // error message — present on failure
}
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Script generation (GPT-4o) + TTS voiceover |
| `PEXELS_API_KEY` | ✅ | Background stock footage |

---

## Temporary files

The orchestrator uses a `temp_videos/` directory in the current working directory for intermediate files. It cleans up per-job work directories automatically on success (final MP4 is kept).

---

## Using video in an agent tool

Expose `VideoOrchestrator` as an agent tool:

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
});

const result = await agent.run('Make me a video about quantum computing.');
```

---

## Where to go next

- [Vision](./vision) — image and multimodal inputs.
- [Voice](./voice) — TTS/STT providers used internally.
- [Workflows](./workflows) — multi-stage processing pipelines.
