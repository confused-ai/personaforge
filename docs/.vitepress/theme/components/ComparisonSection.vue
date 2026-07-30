<script setup lang="ts">
import ComparisonMatrix from './ComparisonMatrix.vue';
</script>

<template>
  <section class="ca-compare-section">
    <div class="ca-compare-inner">
      <div class="ca-section-label">COMPETITIVE LANDSCAPE</div>
      <h2 class="ca-section-title">Enterprise-ready from day one</h2>
      <p class="ca-section-sub">
        No patchwork of add-ons. Every production concern is built-in and composable.
      </p>

      <ComparisonMatrix />

      <p class="ca-compare-cta">
        <a href="/guide/comparisons">Migration guides for LangChain, CrewAI, LangGraph, Mastra &amp; Agno →</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.ca-compare-section {
  padding: 72px 24px;
  background: var(--vp-c-bg-soft);
}

.ca-compare-inner {
  max-width: 1120px;
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
  font-size: clamp(1.6rem, 3vw, 2rem);
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
  margin-bottom: 32px;
  max-width: 640px;
  margin-left: auto;
  margin-right: auto;
}

.ca-compare-cta {
  margin-top: 20px;
  font-size: 0.92rem;
}

.ca-compare-cta a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}

.ca-compare-cta a:hover {
  text-decoration: underline;
}
</style>
