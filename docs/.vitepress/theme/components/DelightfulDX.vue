<script setup lang="ts">
import { ref } from 'vue';

const steps = [
  {
    step: '01',
    title: 'Install one package',
    code: `npm install personaforge`,
    note: 'No 12-step setup. No mandatory config files.',
  },
  {
    step: '02',
    title: 'Set an API key',
    code: `OPENAI_API_KEY=sk-...`,
    note: 'Any of 30+ providers. Swap at any time.',
  },
  {
    step: '03',
    title: 'Run your first agent',
    code: `import { agent } from 'personaforge';
const { text } = await agent('Be helpful.').run('Hello!');`,
    note: 'Smart defaults chosen for you. Override anything.',
  },
];

const features = [
  {
    icon: '🧩',
    title: 'Progressive Escape Hatches',
    desc: 'Start with <code>agent()</code> one-liner. Add tools, sessions, guardrails, budgets one-by-one as you need them. Never rewrite.',
  },
  {
    icon: '📐',
    title: 'Full TypeScript Inference',
    desc: 'Every parameter, every hook, every tool result is typed end-to-end. Autocomplete works everywhere — no <code>any</code>.',
  },
  {
    icon: '🧪',
    title: 'Test Without an LLM',
    desc: '<code>MockLLMProvider</code> + <code>MockToolRegistry</code> let you write fast, deterministic unit tests without real API calls.',
  },
  {
    icon: '⚡',
    title: 'Smart Defaults, Not Magic',
    desc: 'Defaults are explicit and documented. No hidden global state. No invisible retry loops. Every behaviour is opt-in.',
  },
  {
    icon: '🔀',
    title: 'Mix and Match',
    desc: 'Combine <code>createAgent()</code>, <code>compose()</code>, <code>createSupervisor()</code> freely. The abstractions are composable, not hierarchical.',
  },
  {
    icon: '📦',
    title: 'Monorepo Friendly',
    desc: 'Independent subpath imports mean each service only bundles what it needs. Works perfectly with Turborepo, Nx, and Bun workspaces.',
  },
];

const activeStep = ref(0);
</script>

<template>
  <section class="ca-dx-section">
    <div class="ca-dx-inner">
      <div class="ca-section-label">DELIGHTFUL DX</div>
      <h2 class="ca-section-title">Built for developer happiness at every scale</h2>
      <p class="ca-section-sub">
        Zero-to-agent in 3 lines. A path to enterprise that never forces a rewrite.
        Every abstraction earns its place.
      </p>

      <!-- 3-step quick-start -->
      <div class="ca-dx-steps">
        <div
          v-for="(s, i) in steps"
          :key="s.step"
          :class="['ca-dx-step', { 'is-active': activeStep === i }]"
          @mouseenter="activeStep = i"
        >
          <div class="ca-dx-step-num">{{ s.step }}</div>
          <div class="ca-dx-step-body">
            <div class="ca-dx-step-title">{{ s.title }}</div>
            <pre class="ca-dx-step-code"><code>{{ s.code }}</code></pre>
            <div class="ca-dx-step-note">{{ s.note }}</div>
          </div>
        </div>
      </div>

      <!-- DX feature cards -->
      <div class="ca-dx-grid">
        <div v-for="feat in features" :key="feat.title" class="ca-dx-card">
          <span class="ca-dx-card-icon">{{ feat.icon }}</span>
          <div class="ca-dx-card-title">{{ feat.title }}</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="ca-dx-card-desc" v-html="feat.desc" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ca-dx-section {
  padding: 80px 24px;
  background: var(--vp-c-bg-soft);
}

.ca-dx-inner {
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
  max-width: 580px;
  margin-left: auto;
  margin-right: auto;
}

/* ── 3-step quick-start ─────────────────────────────────── */
.ca-dx-steps {
  display: flex;
  gap: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 56px;
  text-align: left;
}

@media (max-width: 700px) {
  .ca-dx-steps { flex-direction: column; }
}

.ca-dx-step {
  flex: 1;
  padding: 28px 24px;
  position: relative;
  cursor: default;
  transition: background 0.22s ease;
  border-right: 1px solid var(--vp-c-divider);
}

.ca-dx-step:last-child {
  border-right: none;
}

.ca-dx-step.is-active {
  background: rgba(20, 184, 166, 0.06);
}

.ca-dx-step-num {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--vp-c-brand-1);
  text-transform: uppercase;
  margin-bottom: 10px;
  opacity: 0.8;
}

.ca-dx-step.is-active .ca-dx-step-num {
  opacity: 1;
}

.ca-dx-step-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
  margin-bottom: 12px;
}

.ca-dx-step-code {
  margin: 0 0 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  font-family: ui-monospace, 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  overflow-x: auto;
  white-space: pre;
}

.ca-dx-step-code code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  color: inherit;
}

.ca-dx-step-note {
  font-size: 12px;
  color: var(--vp-c-text-3);
  line-height: 1.5;
}

/* ── DX feature cards ───────────────────────────────────── */
.ca-dx-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  text-align: left;
}

@media (max-width: 768px) {
  .ca-dx-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .ca-dx-grid { grid-template-columns: 1fr; }
}

.ca-dx-card {
  padding: 22px 20px;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.ca-dx-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 28px rgba(20, 184, 166, 0.1);
}

.ca-dx-card-icon {
  font-size: 1.5rem;
  line-height: 1;
  display: block;
  margin-bottom: 12px;
}

.ca-dx-card-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
  margin-bottom: 8px;
}

.ca-dx-card-desc {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.ca-dx-card-desc :deep(code) {
  font-size: 11.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-family: ui-monospace, monospace;
}
</style>
