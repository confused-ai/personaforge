<script setup lang="ts">
const pillars = [
  {
    icon: '🔒',
    title: 'Security',
    items: [
      'Guardrails engine with sensitive-data rules',
      'JWT RBAC on HTTP routes',
      'Secret-manager adapters (AWS, Azure KV, HashiCorp, GCP)',
      'Content safety hooks',
    ],
  },
  {
    icon: '⚡',
    title: 'Reliability',
    items: [
      'Circuit breakers with configurable thresholds',
      'Exponential-backoff retry with jitter',
      'Redis distributed rate limiting',
      'Graceful shutdown + checkpoint/resume',
    ],
  },
  {
    icon: '📋',
    title: 'Compliance',
    items: [
      'Persistent audit log (SQLite / pluggable)',
      'X-Idempotency-Key deduplication',
      'Per-user and per-tenant cost caps',
      'W3C trace-context propagation',
    ],
  },
  {
    icon: '🔭',
    title: 'Observability',
    items: [
      'OTLP tracing (Jaeger, Datadog, Honeycomb)',
      'Structured logging with context',
      'Eval store + LLM-as-judge scoring',
      'Health endpoints + Grafana dashboard',
    ],
  },
  {
    icon: '🚀',
    title: 'Deployment',
    items: [
      'Docker + docker-compose templates',
      'Kubernetes with rolling updates & probes',
      'Fly.io and Render one-click config',
      'OpenAPI + WebSocket + SSE server built-in',
    ],
  },
  {
    icon: '🧪',
    title: 'Testing',
    items: [
      'MockLLMProvider for deterministic tests',
      'MockToolRegistry + fixture helpers',
      'Vitest-compatible test utilities',
      'Deterministic tests — no live API calls',
    ],
  },
];
</script>

<template>
  <section class="ca-ent-section">
    <div class="ca-ent-inner">
      <div class="ca-section-label">ENTERPRISE CHECKLIST</div>
      <h2 class="ca-section-title">Everything you need to go to production</h2>
      <p class="ca-section-sub">
        No switching frameworks at scale. Every capability ships with <code>confused-ai</code>.
      </p>

      <div class="ca-ent-grid">
        <div v-for="pillar in pillars" :key="pillar.title" class="ca-ent-card">
          <div class="ca-ent-card-head">
            <span class="ca-ent-icon">{{ pillar.icon }}</span>
            <span class="ca-ent-title">{{ pillar.title }}</span>
          </div>
          <ul class="ca-ent-list">
            <li v-for="item in pillar.items" :key="item">
              <svg class="ca-check" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="7" fill="rgba(20, 184, 166,0.15)"/>
                <path d="M4 7l2.2 2.2L10 5" stroke="#14b8a6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {{ item }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ca-ent-section {
  padding: 80px 24px;
}

.ca-ent-inner {
  max-width: 960px;
  margin: 0 auto;
  text-align: center;
}

.ca-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--vp-c-brand-1);
  text-transform: uppercase;
  margin-bottom: 12px;
}

.ca-section-title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  margin-bottom: 12px;
  border-top: none !important;
  padding-top: 0 !important;
}

.ca-section-sub {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  margin-bottom: 48px;
}

.ca-section-sub code {
  font-size: 0.9em;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.ca-ent-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  text-align: left;
}

@media (max-width: 768px) {
  .ca-ent-grid { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 480px) {
  .ca-ent-grid { grid-template-columns: 1fr; }
}

.ca-ent-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  padding: 24px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}

.ca-ent-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 28px rgba(20, 184, 166, 0.12);
}

.ca-ent-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.ca-ent-icon {
  font-size: 1.3rem;
  line-height: 1;
}

.ca-ent-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.ca-ent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ca-ent-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.ca-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
</style>
