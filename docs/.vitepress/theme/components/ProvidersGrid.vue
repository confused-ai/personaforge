<script setup lang="ts">
const providers = [
  { name: 'OpenAI', badge: 'GPT & o-series', env: 'OPENAI_API_KEY', color: '#10a37f' },
  { name: 'Anthropic', badge: 'Claude family', env: 'ANTHROPIC_API_KEY', color: '#d97706' },
  { name: 'Google', badge: 'Gemini family', env: 'GOOGLE_API_KEY', color: '#4285f4' },
  { name: 'OpenRouter', badge: '100+ models', env: 'OPENROUTER_API_KEY', color: '#14b8a6' },
  { name: 'Azure OpenAI', badge: 'Enterprise', env: 'OPENAI_BASE_URL', color: '#0078d4' },
  { name: 'AWS Bedrock', badge: 'Peer dep', env: '@aws-sdk/...', color: '#f59e0b' },
  { name: 'Any OpenAI-compat', badge: 'Custom URL', env: 'apiKey + baseURL', color: '#22c55e' },
  { name: 'Ollama', badge: 'Local', env: 'No key needed', color: '#64748b' },
];
</script>

<template>
  <section class="ca-providers-section">
    <div class="ca-providers-inner">
      <div class="ca-section-label">LLM PROVIDERS</div>
      <h2 class="ca-section-title">One framework, every model</h2>
      <p class="ca-section-sub">
        30+ providers built-in. Swap with one import — the same agent code runs on every model.
      </p>

      <div class="ca-providers-grid">
        <div v-for="p in providers" :key="p.name" class="ca-provider-card">
          <div class="ca-provider-dot" :style="{ background: p.color }" />
          <div class="ca-provider-info">
            <span class="ca-provider-name">{{ p.name }}</span>
            <span class="ca-provider-badge">{{ p.badge }}</span>
          </div>
          <code class="ca-provider-env">{{ p.env }}</code>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ca-providers-section {
  padding: 80px 24px;
  background: var(--vp-c-bg-soft);
}

.ca-providers-inner {
  max-width: 900px;
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

.ca-providers-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

@media (max-width: 768px) {
  .ca-providers-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .ca-providers-grid { grid-template-columns: 1fr; }
}

.ca-provider-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  text-align: left;
}

.ca-provider-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 6px 20px rgba(20, 184, 166, 0.1);
}

.ca-provider-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ca-provider-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ca-provider-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ca-provider-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ca-provider-env {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
</style>
