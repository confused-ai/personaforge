# personaforge Deployment Templates

Production-ready templates for deploying your agent to various platforms.

## Quick start

Copy the template for your target platform and fill in the `<placeholders>`.

| Platform | Template |
|---|---|
| Docker (self-hosted) | `Dockerfile` |
| Docker Compose | `docker-compose.yml` |
| Fly.io | `fly.toml` |
| Render | `render.yaml` |
| Kubernetes | `k8s.yaml` |

## Minimal server file

Create `src/server.ts` (adapt to your stack):

```typescript
import { createHttpService, listenService } from 'personaforge/runtime';
import { createAgent } from 'personaforge';
import { openai } from 'personaforge/llm';

const assistant = createAgent({
  name: 'assistant',
  llm: openai({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY! }),
  instructions: 'You are a helpful assistant.',
});

const svc = createHttpService({ agents: { assistant } });
await listenService(svc);
console.log(`Listening on :${svc.port}`);
```

Then set `OPENAI_API_KEY` (or your LLM provider key) and run.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes (if using OpenAI) | OpenAI API key |
| `PORT` | No | HTTP port (default: `8787`) |
| `AGENT_DB_PATH` | No | SQLite path for sessions/checkpoints/audit |
| `ADMIN_TOKEN` | No | Bearer token protecting `/admin/*` endpoints |
| `REDIS_URL` | No | Redis URL for session store (e.g. `redis://localhost:6379`) |
