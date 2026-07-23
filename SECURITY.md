# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅ Current |
| 1.0.x   | ⚠️ Critical fixes only |
| < 1.0   | ❌ No support |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Email: **security@personaforge.dev** (or substitute your actual security contact).

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Any proof-of-concept code (privately)

We target a **72-hour acknowledgement** and **14-day patch cycle** for critical issues.

## Security Considerations

### ShellTool — Sandbox Requirements

`shell` (from `@personaforge/tools`) executes arbitrary system commands. It is **not
included** in the default tool barrel to reduce supply-chain risk, but if you use it
you **must** apply the following isolation:

- Run the agent process inside a container with a **read-only root filesystem**
- Set a **restricted PATH** — expose only the binaries you intend to allow
- Apply **seccomp** or **AppArmor** profiles to block syscalls you don't need
- Run as a **non-root user** (uid 1000+)
- Set resource limits: CPU, memory, and wall-clock timeout (`timeout` option)
- **Never** mount secrets, credentials, or cloud metadata endpoints into a container running ShellTool

```ts
// Explicit import required — NOT in the default barrel
import { shell } from '@personaforge/tools/shell';
```

If you cannot provide container isolation, disable ShellTool entirely and use
`fileSystem` with explicit path allow-lists instead.

### JWT / Authentication

- **HS256 secret strength**: Secrets must be at least 32 characters long. Shorter secrets are vulnerable to brute-force. Use `crypto.randomBytes(32).toString('hex')` to generate.
- **RS256 / ES256**: Use asymmetric keys for multi-service deployments. Pass a PEM-encoded public key to `jwtAuth({ publicKey })`. Never expose private keys in environment variables visible to the agent process.
- **Token expiry**: Always set `exp` in issued JWTs. The `verifyJwtHs256` and `verifyJwtAsymmetric` functions enforce expiry and will throw `expired` errors.
- **Timing-safe comparison**: HS256 signature verification uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Public paths**: `/health` and `/v1/health` are public by default. Do not put sensitive data in health check responses.

### API Key Management

- Store LLM provider keys (OpenAI, Anthropic, etc.) in environment variables — never hardcode in source.
- Use `.env.example` (committed) and `.env` (gitignored) pattern.
- The `personaforge doctor` command validates that required keys are present without logging their values.

### Rate Limiting

- Wire `rateLimit` into `createHttpService` to prevent abuse:
  ```ts
  import { RateLimiter } from 'personaforge/guard';

  createHttpService({
    rateLimit: new RateLimiter({ name: 'http', maxRequests: 100, intervalMs: 60_000 }),
  });
  ```
- **Multi-instance deployments**: The default `RateLimiter` is in-process only — two replicas means double the effective limit. Use `RedisRateLimiter` for distributed enforcement:
  ```ts
  import { RedisRateLimiter } from '@personaforge/adapter-redis';

  createHttpService({
    rateLimit: new RedisRateLimiter({ client: redisClient, maxRequests: 100, windowMs: 60_000 }),
  });
  ```
- Rate limiting is keyed on authenticated identity when available, falling back to `X-Forwarded-For` and remote address.

### Guardrails

- **PII detection**: Use `createPiiDetectionRule` to prevent sensitive data leakage in agent outputs.
- **Prompt injection**: Use `createPromptInjectionRule` to detect user attempts to override agent instructions.
- **Output validation**: Use `GuardrailValidator` with schema rules to constrain agent outputs.
- The LLM injection classifier (`createLlmInjectionClassifier`) provides highest accuracy but has cost/latency implications — use for sensitive operations.

### Dependency Security

- Run `npm audit` / `bun audit` regularly.
- The circuit breaker (`CircuitBreaker`) prevents runaway calls to degraded LLM providers, reducing blast radius from provider incidents.
- `BudgetEnforcer` enforces hard USD caps to prevent runaway costs from prompt injection or bugs.

### Input Validation

- All HTTP endpoints parse JSON with a try/catch — malformed JSON returns 400.
- Session IDs and agent names are validated before routing.
- Tool arguments are validated against Zod schemas before execution.

### Production Hardening Checklist

- [ ] Set `JWT_SECRET` or asymmetric key pair in environment
- [ ] Enable rate limiting on the HTTP service (use `RedisRateLimiter` for multi-instance)
- [ ] Add PII detection guardrail for any user-facing agents
- [ ] Set budget caps (`maxUsdPerRun`, `maxUsdPerUser`) to prevent runaway costs
- [ ] Use HTTPS termination at the load balancer / reverse proxy
- [ ] Rotate secrets on a regular schedule
- [ ] Monitor the `/v1/admin/health` endpoint for circuit breaker state
- [ ] Run `personaforge doctor` in CI to validate env vars before deploy
- [ ] If using ShellTool: run agent in isolated container with restricted PATH and non-root user
