---
title: Vision
description: Pass images, files, and audio to agents with imageUrl(), imageFile(), imageBuffer(), and multiModal(). Supports HTTPS URLs, local files, ArrayBuffers, and mixed text+image messages.
outline: [2, 3]
---

# Vision

Vision lets you pass images, PDFs, and other media to vision-capable models. Use the `multiModal()` helper to combine text prompts with one or more image sources.

```ts
import {
  multiModal,
  imageUrl,
  imageFile,
  imageBuffer,
} from 'personaforge';
```

---

## Pass a remote image

```ts
import { createAgent, multiModal, imageUrl } from 'personaforge';

const agent = createAgent({
  name: 'vision-agent',
  instructions: 'Analyse the images provided by the user.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});

const result = await agent.run(
  await multiModal(
    'What is in this image?',
    imageUrl('https://example.com/photo.jpg'),
  ),
);
```

---

## Pass a local file

```ts
import { multiModal, imageFile } from 'personaforge';

// imageFile() is async — loads and base64-encodes the file
const result = await agent.run(
  await multiModal(
    'Describe this chart.',
    await imageFile('./chart.png'),
  ),
);
```

---

## Pass a buffer (canvas, upload, fetch response)

```ts
import { multiModal, imageBuffer } from 'personaforge';

const response = await fetch('https://example.com/diagram.png');
const buffer = await response.arrayBuffer();

const result = await agent.run(
  await multiModal(
    'What does this architecture diagram show?',
    imageBuffer(buffer, 'image/png'),
  ),
);
```

---

## Multiple images in one message

```ts
const result = await agent.run(
  await multiModal(
    'Compare these two screenshots and explain the differences.',
    imageUrl(beforeUrl),
    imageUrl(afterUrl),
  ),
);
```

---

## Image detail level

Control quality vs. speed with the `detail` option:

```ts
imageUrl('https://example.com/photo.jpg', { detail: 'high' })
imageUrl('https://example.com/thumbnail.jpg', { detail: 'low' })
// 'auto' (default) — model decides
```

---

## `ImageSource` types

| Type | Factory | Description |
|---|---|---|
| `ImageUrl` | `imageUrl(url, opts?)` | HTTPS or data URI |
| `ImageFile` | `await imageFile(path, opts?)` | Local file — loaded at call time (Node.js only) |
| `ImageBuffer` | `imageBuffer(data, mimeType, opts?)` | Raw ArrayBuffer / Uint8Array |

---

## Supported formats

Images: `jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp`, `svg`, `tiff`, `heic`  
Audio: `mp3`, `wav`, `ogg`, `m4a`, `flac`, `webm`  
Video: `mp4`, `webm`, `mov`, `avi`, `mkv`

---

## Where to go next

- [Voice](./voice) — speech input and output.
- [Video](./video) — process and summarise video content.
- [Agents](./agents) — `agent.run()` multiModal option.
