# Live-model integration tests

These tests call **real** provider APIs. They are excluded from the default
`bun run test` unit suite and run only via:

```bash
bun run test:integration
```

## Credentials

Each test self-skips when its required credential is absent, so you can run the
suite with only the providers you have keys for. Set any of:

| Provider  | Env var             | Notes                                  |
|-----------|---------------------|----------------------------------------|
| OpenAI    | `OPENAI_API_KEY`    | uses `gpt-4o-mini` by default          |
| Anthropic | `ANTHROPIC_API_KEY` | uses `claude-3-5-haiku-latest`         |
| Google    | `GOOGLE_API_KEY`    | uses `gemini-1.5-flash`                 |
| Ollama    | `OLLAMA_HOST`       | local; uses `llama3.2` by default      |

Override the model per provider with `PF_IT_OPENAI_MODEL`, `PF_IT_ANTHROPIC_MODEL`,
`PF_IT_GOOGLE_MODEL`, `PF_IT_OLLAMA_MODEL`.

## Cost

The suite is intentionally tiny (a handful of short prompts). It is meant to
catch **adapter drift** — request/response shape changes, auth regressions,
finish-reason vocabulary changes — that unit tests with mocks cannot see.

## CI

Not run on every PR. Wire it into a scheduled (nightly) workflow or a manual
`workflow_dispatch` with the secrets configured, so live cost is controlled.
