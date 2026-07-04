---
title: Artifacts
description: Create and store typed durable outputs (files, images, code, data, reports, plans). createTextArtifact, createMarkdownArtifact, createDataArtifact, createPlanArtifact, createReasoningArtifact. InMemoryArtifactStorage.
outline: [2, 3]
---

# Artifacts

Artifacts are typed, versioned outputs produced by an agent run — files, reports, code, structured data, plans, reasoning traces — that should persist beyond the message text.

```ts
import {
  createTextArtifact,
  createMarkdownArtifact,
  createDataArtifact,
  createPlanArtifact,
  createReasoningArtifact,
  InMemoryArtifactStorage,
} from 'confused-ai/artifacts';
```

---

## Artifact types

```ts
type ArtifactType =
  | 'file'
  | 'image'
  | 'audio'
  | 'video'
  | 'code'
  | 'data'
  | 'document'
  | 'markdown'
  | 'json'
  | 'reasoning'
  | 'plan'
  | 'report';
```

---

## Create artifacts

```ts
import {
  createTextArtifact,
  createMarkdownArtifact,
  createDataArtifact,
  createPlanArtifact,
  createReasoningArtifact,
} from 'confused-ai/artifacts';

// Plain text / code file
const code = createTextArtifact({
  name: 'auth-handler.ts',
  content: `export function verifyToken(token: string) { ... }`,
  type: 'code',
  mimeType: 'text/typescript',
  tags: ['auth', 'typescript'],
  createdBy: 'code-agent',
});

// Markdown report
const report = createMarkdownArtifact({
  name: 'Q4-report.md',
  content: '## Q4 Summary\n\nRevenue up 12% YoY...',
  tags: ['report', 'q4'],
});

// Structured data
const data = createDataArtifact({
  name: 'search-results',
  content: { query: 'LLM benchmarks', results: [...] },
  type: 'json',
});

// Agent reasoning trace
const trace = createReasoningArtifact({
  steps: [
    { title: 'Analyse', action: 'Read the requirements', result: '...', confidence: 0.9 },
  ],
  conclusion: 'Use a queue-based approach.',
  model: 'gpt-4o',
});

// Execution plan
const plan = createPlanArtifact({
  goal: 'Migrate database to PostgreSQL',
  tasks: [
    { id: '1', name: 'Backup current DB', priority: 0 },
    { id: '2', name: 'Provision RDS', priority: 1, dependencies: ['1'] },
  ],
});
```

---

## `ArtifactMetadata` fields

All artifacts share these fields:

```ts
interface ArtifactMetadata {
  id: string;             // auto-generated UUID
  name: string;           // human-readable name
  type: ArtifactType;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;        // starts at 1
  tags?: string[];
  metadata?: Record<string, unknown>;  // custom key-value pairs
  createdBy?: string;     // agent name
  sessionId?: string;
}
```

---

## Store artifacts

```ts
import { InMemoryArtifactStorage } from 'confused-ai/artifacts';

const storage = new InMemoryArtifactStorage({
  maxSizeBytes: 100 * 1024 * 1024,  // 100 MB per artifact (default)
  versioning: true,                 // keep a full version history (default: true)
  // basePath?, ttlMs?, metrics? — see ArtifactStorageConfig
});

// Save (creates version 1; id/createdAt/version are generated)
const stored = await storage.save(report);

// Retrieve
const retrieved = await storage.get(stored.id);

// List by type
const allReports = await storage.list({
  type: 'markdown',
  tags: ['q4'],
  createdBy: 'report-agent',
});

// Search
const results = await storage.search('Q4 revenue');

// Delete
await storage.delete(stored.id);
```

---

## Emit artifacts from agent hooks

Attach artifact creation to the `afterRun` hook to capture every run's output:

```ts
import { createAgent } from 'confused-ai';
import { InMemoryArtifactStorage, createMarkdownArtifact } from 'confused-ai/artifacts';

const artifactStorage = new InMemoryArtifactStorage();

const agent = createAgent({
  name: 'report-agent',
  instructions: 'Generate detailed reports when asked.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    afterRun: async (result) => {
      // Persist agent text output as a markdown artifact
      const artifact = createMarkdownArtifact({
        name: `report-${result.runId}.md`,
        content: result.text,
        createdBy: 'report-agent',
        metadata: { runId: result.runId, tokens: result.usage?.totalTokens },
      });
      await artifactStorage.save(artifact);
      return result;
    },
  },
});
```

---

## `ArtifactStorage` interface

Implement this to persist artifacts to S3, GCS, or any external store:

```ts
interface ArtifactStorage {
  save<T>(artifact: Omit<Artifact<T>, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Artifact<T>>;
  get<T>(id: string): Promise<Artifact<T> | null>;
  getVersion<T>(id: string, version: number): Promise<Artifact<T> | null>;
  listVersions(id: string): Promise<ArtifactMetadata[]>;
  update<T>(id: string, updates: Partial<Omit<Artifact<T>, 'id' | 'createdAt' | 'version'>>): Promise<Artifact<T>>;
  delete(id: string): Promise<boolean>;
  list(filters?: {
    type?: ArtifactType;
    tags?: string[];
    createdBy?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactMetadata[]>;
  search(query: string, limit?: number): Promise<ArtifactMetadata[]>;
}
```

---

## Versioning

Storage keeps a full version history (toggle with `versioning` in
`ArtifactStorageConfig`). `update()` creates a new version; `getVersion()` and
`listVersions()` read the history:

```ts
const stored = await storage.save(report);   // version 1

// update() records a new version (2, 3, …)
const v2 = await storage.update(stored.id, {
  content: '## Q4 Summary (revised)\n\nRevenue up 14% YoY...',
});

const history = await storage.listVersions(stored.id);   // ArtifactMetadata[]
const original = await storage.getVersion(stored.id, 1);
```

---

## Media artifacts

Images, audio, and video are first-class artifact types. Build them with the
media helpers, or manage them through `MediaManager` against any `ArtifactStorage`.

```ts
import {
  MediaManager,
  createImageFromUrl,
  createImageFromBase64,
  createAudioFromUrl,
  createVideoFromUrl,
  InMemoryArtifactStorage,
} from 'confused-ai/artifacts';
import type { ImageArtifact, AudioArtifact, VideoArtifact } from 'confused-ai/artifacts';

// Build media artifacts directly (each returns an artifact ready for storage.save()):
const image = createImageFromUrl('hero.png', 'https://cdn.example.com/hero.png', {
  width: 1024, height: 768, prompt: 'a mountain at sunrise', model: 'dall-e-3',
});
const inline = createImageFromBase64('chart.png', base64Data, 'image/png');
const speech = createAudioFromUrl('greeting.mp3', 'https://cdn.example.com/greeting.mp3', {
  durationSeconds: 3.2, voiceId: 'alloy', transcript: 'Hello there.',
});
const clip = createVideoFromUrl('demo.mp4', 'https://cdn.example.com/demo.mp4', {
  durationSeconds: 30, width: 1920, height: 1080, fps: 30,
});

// …or use MediaManager to save + retrieve in one call:
const media = new MediaManager(new InMemoryArtifactStorage());
const savedImage: ImageArtifact = await media.saveImage('hero.png', 'https://cdn.example.com/hero.png', { width: 1024, height: 768 });
const savedAudio: AudioArtifact = await media.saveAudio('greeting.mp3', 'https://cdn.example.com/greeting.mp3');
const savedVideo: VideoArtifact = await media.saveVideo('demo.mp4', 'https://cdn.example.com/demo.mp4');
```

---

## Where to go next

- [Storage](./storage) — key-value storage for lighter-weight state.
- [Hooks](./hooks) — `afterRun` where artifacts are typically created.
- [Production](./production) — audit stores for compliance.
