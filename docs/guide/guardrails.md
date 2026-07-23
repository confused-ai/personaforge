---
title: Guardrails
description: Validate inputs and outputs, detect PII, block prompt injection, moderate content, and enforce allowlists with GuardrailValidator.
outline: [2, 3]
---

# Guardrails

Guardrails run before and after each agent step to validate messages, detect unsafe content, and enforce policies. The framework ships a `GuardrailValidator` with composable rules that you pass to `createAgent()`.

## Quick start

```ts
import { createAgent } from 'personaforge';
import { GuardrailValidator, createPiiDetectionRule, createPromptInjectionRule } from 'personaforge';

const guardrails = new GuardrailValidator({
  rules: [
    createPromptInjectionRule({ threshold: 0.7 }),
    createPiiDetectionRule({ redact: true }),
  ],
});

const agent = createAgent({
  name: 'safe-agent',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  guardrails,
});
```

Pass `guardrails: false` to disable all guardrails.

---

## `GuardrailValidator`

The core engine. Compose any combination of built-in and custom rules.

```ts
import { GuardrailValidator } from 'personaforge';

const guardrails = new GuardrailValidator({
  rules: [rule1, rule2, rule3],
  onViolation: (violation, ctx) => {
    // called when any rule fires
    console.warn('Guardrail violation:', violation.rule, violation.message);
    // return 'block' | 'warn' | 'redact' | 'continue'
  },
});
```

---

## PII detection

Detect and optionally redact personally identifiable information:

```ts
import { createPiiDetectionRule } from 'personaforge';

const piiRule = createPiiDetectionRule({
  redact: true,           // replace PII with [REDACTED]
  // redact: false        // just flag without modifying

  // PII types to detect (all enabled by default):
  types: ['email', 'phone', 'ssn', 'credit_card', 'jwt', 'aws_key', 'api_key'],
});
```

**Detected PII types:** `email` · `phone` · `ssn` · `credit_card` · `national_insurance` · `passport` · `aws_key` · `api_key` · `jwt` · and more from `PII_PATTERNS`.

```ts
import { detectPii, PII_PATTERNS } from 'personaforge';

// Use standalone (no agent required) — detectPii is synchronous
const result = detectPii('Contact me at alice@example.com or 555-123-4567', { extract: true });
console.log(result.found);    // true
console.log(result.types);    // ['email', 'phone']
console.log(result.matches);  // { email: ['alice@example.com'], phone: ['555-123-4567'] }
```

---

## Prompt injection detection

Block attempts to hijack the agent via crafted input:

```ts
import { createPromptInjectionRule, detectPromptInjection } from 'personaforge';

const injectionRule = createPromptInjectionRule({
  threshold: 0.7,    // 0.0–1.0; higher = stricter. Default: 0.7
});

// Standalone usage — detectPromptInjection is synchronous:
const detection = detectPromptInjection('Ignore all previous instructions and...');
console.log(detection.isInjection); // true
console.log(detection.score);       // 0.95
console.log(detection.signals);     // [{ pattern: 'instruction-override', description, weight, match }, ...]
```

### LLM-based injection classifier (higher accuracy)

```ts
import { createLlmInjectionClassifier } from 'personaforge';
import { OpenAIProvider } from 'personaforge';

const injectionRule = createLlmInjectionClassifier({
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  model: 'gpt-4o-mini',
  threshold: 0.8,
});
```

---

## Content moderation

### OpenAI Moderation API

```ts
import { createOpenAiModerationRule } from 'personaforge';

const moderationRule = createOpenAiModerationRule({
  apiKey: process.env.OPENAI_API_KEY!,
  // Block if any category score exceeds threshold:
  thresholds: {
    hate: 0.7,
    'hate/threatening': 0.5,
    harassment: 0.7,
    'self-harm': 0.5,
    sexual: 0.8,
    violence: 0.7,
  },
});
```

### Forbidden topics

```ts
import { createForbiddenTopicsRule } from 'personaforge';

const topicsRule = createForbiddenTopicsRule({
  topics: ['competitor pricing', 'internal salary data', 'acquisition plans'],
  action: 'block',  // 'block' | 'warn'
});
```

---

## Content and length rules

```ts
import {
  createContentRule,
  createMaxLengthRule,
  createAllowlistRule,
  createSensitiveDataRule,
  createUrlValidationRule,
} from 'personaforge';

const rules = [
  // Block responses that contain specific patterns.
  // Signature: createContentRule(name, description, pattern, severity?)
  createContentRule(
    'no-credentials',
    'Blocks responses containing credential patterns.',
    /\b(password|secret|token)\s*[:=]/i,
    'error',
  ),

  // Limit output length.
  // Signature: createMaxLengthRule(name, maxLength, severity?)
  createMaxLengthRule('max-length', 10_000, 'error'),

  // Enforce an allowlist over tools, hosts, paths, outputs, and blocked patterns.
  createAllowlistRule({
    allowedTools: ['search', 'get_order'],
    allowedHosts: ['api.company.com', 'docs.company.com'],
    blockedPatterns: [/\b(password|secret)\b/i],
  }),

  // Flag built-in sensitive data patterns (credit cards, SSNs, API keys). No args.
  createSensitiveDataRule(),

  // Restrict URLs to allowed protocols (and optionally hosts).
  // Signature: createUrlValidationRule(allowedProtocols, allowedHosts?)
  createUrlValidationRule(['https:'], ['api.company.com', 'docs.company.com']),
];
```

---

## Tool allowlist

Restrict which tools the agent can call from within a guardrail rule:

```ts
import { createToolAllowlistRule } from 'personaforge';

// Signature: createToolAllowlistRule(allowedTools). Any tool not in the list
// is blocked before execution.
const toolRule = createToolAllowlistRule(['search_orders', 'get_product_info']);
```

---

## Custom rules

```ts
import type { GuardrailRule, GuardrailContext, GuardrailResult } from 'personaforge';

const noProfanityRule: GuardrailRule = {
  name: 'no-profanity',
  description: 'Blocks prohibited language in agent output.',
  severity: 'error',   // 'error' | 'warning'
  check: (ctx: GuardrailContext): GuardrailResult => {
    const text = typeof ctx.output === 'string' ? ctx.output : '';
    const hasProfanity = /\b(badword1|badword2)\b/i.test(text);

    if (hasProfanity) {
      return {
        passed: false,
        rule: 'no-profanity',
        message: 'Response contains prohibited language.',
      };
    }
    return { passed: true, rule: 'no-profanity' };
  },
};

const guardrails = new GuardrailValidator({ rules: [noProfanityRule] });
```

---

## Full example: production guardrail stack

```ts
import { createAgent } from 'personaforge';
import {
  GuardrailValidator,
  createPromptInjectionRule,
  createPiiDetectionRule,
  createOpenAiModerationRule,
  createForbiddenTopicsRule,
  createMaxLengthRule,
  createToolAllowlistRule,
} from 'personaforge';

const guardrails = new GuardrailValidator({
  rules: [
    createPromptInjectionRule({ threshold: 0.75 }),
    createPiiDetectionRule({ redact: true }),
    createOpenAiModerationRule({ apiKey: process.env.OPENAI_API_KEY! }),
    createForbiddenTopicsRule({ topics: ['competitor pricing', 'legal strategy'] }),
    createMaxLengthRule('max-length', 8_000, 'error'),
    createToolAllowlistRule(['search', 'get_order', 'send_email']),
  ],
  onViolation: (violation) => {
    // Send to your audit log
    auditLogger.warn({ rule: violation.rule, action: violation.action, score: violation.score });
  },
});

const agent = createAgent({
  name: 'customer-service',
  instructions: 'You are a customer service agent for Acme Corp.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  guardrails,
  tools: [searchTool, orderTool, emailTool],
});
```

---

## Where to go next

- [HITL](./hitl) — escalate violations to a human instead of auto-blocking.
- [Production](./production) — rate limiting, circuit breakers, and audit logging.
- [Agents](./agents) — how guardrails fit into the full `createAgent()` config.
