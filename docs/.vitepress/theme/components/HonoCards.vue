<script setup lang="ts">
const cards = [
  {
    emoji: '🔋',
    title: 'Batteries Included',
    desc: 'Confused-AI ships with 100+ built-in tools, multi-agent orchestration, RAG, guardrails, session stores, circuit breakers, budget enforcement, OTLP tracing, HITL, MCP, voice, and deployment templates. Everything you need — none of the glue code.',
    link: '/guide/tools',
    linkText: 'Browse all tools →',
  },
  {
    emoji: '😃',
    title: 'Delightful DX',
    desc: 'Super clean APIs. Three lines to a working agent. Full TypeScript inference end-to-end. Mock providers for fast unit tests. Progressive escape hatches — start simple, go enterprise without ever rewriting.',
    link: '/guide/getting-started',
    linkText: 'Get started →',
  },
];
</script>

<template>
  <section class="hc-section">
    <div class="hc-inner">
      <div class="hc-grid">
        <a
          v-for="card in cards"
          :key="card.title"
          :href="card.link"
          class="hc-card"
        >
          <div class="hc-icon-box">
            <span class="hc-emoji">{{ card.emoji }}</span>
          </div>
          <h3 class="hc-title">{{ card.title }}</h3>
          <p class="hc-desc">{{ card.desc }}</p>
          <span class="hc-link">{{ card.linkText }}</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hc-section {
  padding: 64px 24px 0;
}

.hc-inner {
  max-width: 960px;
  margin: 0 auto;
}

.hc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

@media (max-width: 640px) {
  .hc-grid { grid-template-columns: 1fr; }
}

/* ── Card ───────────────────────────────────────────────── */
.hc-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 36px 32px 32px;
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  color: inherit;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}

.dark .hc-card {
  background: rgba(255, 255, 255, 0.03);
}

.hc-card:hover {
  transform: translateY(-4px);
  border-color: var(--vp-c-brand-1);
  box-shadow:
    0 12px 40px rgba(20, 184, 166, 0.14),
    0 2px 8px rgba(0, 0, 0, 0.06);
}

/* ── Icon box ───────────────────────────────────────────── */
.hc-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.2s ease;
  flex-shrink: 0;
}

.hc-card:hover .hc-icon-box {
  box-shadow:
    0 4px 16px rgba(20, 184, 166, 0.18),
    0 0 0 1px rgba(20, 184, 166, 0.12);
}

.hc-emoji {
  font-size: 2rem;
  line-height: 1;
  display: block;
}

/* ── Text ───────────────────────────────────────────────── */
.hc-title {
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--vp-c-text-1);
  line-height: 1.2;
  margin: 0;
  border-top: none !important;
  padding-top: 0 !important;
}

.hc-desc {
  font-size: 15px;
  color: var(--vp-c-text-2);
  line-height: 1.7;
  margin: 0;
  flex: 1;
}

.hc-link {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.01em;
  transition: gap 0.2s ease;
}

.hc-card:hover .hc-link {
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
