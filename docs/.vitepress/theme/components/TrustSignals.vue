<script setup lang="ts">
const metrics = [
  { value: '1,500+', label: 'Automated Tests', detail: 'Hermetic MockLLM — no live API calls in CI' },
  { value: '92%', label: 'τ-bench Pass Rate', detail: '12/13 tool-calling tasks on gpt-4o-mini' },
  { value: '43%+', label: 'CI Coverage Floor', detail: 'Ratcheting quarterly toward 75%' },
  { value: 'MIT', label: 'Open Source', detail: 'No telemetry by default · zero lock-in' },
];

const signals = [
  {
    icon: '🔒',
    title: 'Security-first',
    body: 'Private vulnerability disclosure, JWT hardening, SSRF-protected tools, and a production hardening checklist.',
    link: '/guide/trust#security',
  },
  {
    icon: '🧪',
    title: 'Tested in CI',
    body: '1,500+ tests across 124 files. MockLLMProvider for deterministic runs. Coverage gates enforced on every PR.',
    link: '/guide/trust#testing',
  },
  {
    icon: '📊',
    title: 'Benchmarked',
    body: 'τ-bench harness with verifier-based scoring. Cross-framework protocol for LangGraph, Agno, CrewAI, and Mastra.',
    link: '/guide/trust#benchmarks',
  },
  {
    icon: '🔭',
    title: 'Observable',
    body: 'OpenTelemetry-native tracing, tamper-evident audit logs, Prometheus metrics, and a built-in control plane.',
    link: '/guide/trust#observability',
  },
];
</script>

<template>
  <section class="ca-trust-section">
    <div class="ca-trust-inner">
      <div class="ca-section-label">WHY TRUST PERSONAFORGE</div>
      <h2 class="ca-section-title">Built for production, proven in CI</h2>
      <p class="ca-section-sub">
        Capability claims are easy. We publish the evidence — tests, benchmarks, security policy, and governance.
      </p>

      <div class="ca-trust-metrics">
        <div v-for="m in metrics" :key="m.label" class="ca-trust-metric">
          <span class="ca-trust-value">{{ m.value }}</span>
          <span class="ca-trust-label">{{ m.label }}</span>
          <span class="ca-trust-detail">{{ m.detail }}</span>
        </div>
      </div>

      <div class="ca-trust-grid">
        <a
          v-for="signal in signals"
          :key="signal.title"
          :href="signal.link"
          class="ca-trust-card"
        >
          <div class="ca-trust-card-head">
            <span class="ca-trust-icon">{{ signal.icon }}</span>
            <span class="ca-trust-card-title">{{ signal.title }}</span>
          </div>
          <p class="ca-trust-card-body">{{ signal.body }}</p>
          <span class="ca-trust-card-link">Learn more →</span>
        </a>
      </div>

      <p class="ca-trust-cta">
        <a href="/guide/trust">Read the full trust &amp; reliability guide →</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.ca-trust-section {
  padding: 80px 24px;
  background: var(--vp-c-bg);
}

.ca-trust-inner {
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
  margin-bottom: 40px;
}

.ca-trust-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 40px;
  background: var(--vp-c-bg-soft);
}

@media (max-width: 768px) {
  .ca-trust-metrics { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .ca-trust-metrics { grid-template-columns: 1fr; }
}

.ca-trust-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 16px;
  border-right: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  transition: background 0.2s ease;
}

.ca-trust-metric:nth-child(4n) { border-right: none; }
.ca-trust-metric:nth-last-child(-n+4) { border-bottom: none; }

@media (max-width: 768px) {
  .ca-trust-metric:nth-child(4n) { border-right: 1px solid var(--vp-c-divider); }
  .ca-trust-metric:nth-child(2n) { border-right: none; }
  .ca-trust-metric:nth-last-child(-n+4) { border-bottom: 1px solid var(--vp-c-divider); }
  .ca-trust-metric:nth-last-child(-n+2) { border-bottom: none; }
}

@media (max-width: 480px) {
  .ca-trust-metric { border-right: none !important; }
  .ca-trust-metric:last-child { border-bottom: none; }
}

.ca-trust-metric:hover {
  background: var(--vp-c-brand-soft);
}

.ca-trust-value {
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
}

.ca-trust-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 6px;
}

.ca-trust-detail {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
  line-height: 1.4;
  text-align: center;
}

.ca-trust-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  text-align: left;
  margin-bottom: 32px;
}

@media (max-width: 640px) {
  .ca-trust-grid { grid-template-columns: 1fr; }
}

.ca-trust-card {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  padding: 24px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}

.ca-trust-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 28px rgba(20, 184, 166, 0.12);
}

.ca-trust-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.ca-trust-icon {
  font-size: 1.3rem;
  line-height: 1;
}

.ca-trust-card-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ca-trust-card-body {
  font-size: 13.5px;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin: 0 0 12px;
}

.ca-trust-card-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.ca-trust-cta a {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.ca-trust-cta a:hover {
  text-decoration: underline;
}
</style>
