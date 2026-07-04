<script setup lang="ts">
const stats = [
  { value: '100+', label: 'Built-in Tools' },
  { value: '20+', label: 'Vector Stores' },
  { value: '30+', label: 'LLM Providers' },
  { value: 'MIT', label: 'Open Source' },
];
</script>

<template>
  <div class="ca-stats-bar">
    <div class="ca-stats-inner">
      <div v-for="stat in stats" :key="stat.label" class="ca-stat-item">
        <span class="ca-stat-value">{{ stat.value }}</span>
        <span class="ca-stat-label">{{ stat.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ca-stats-bar {
  padding: 0 24px 12px;
}

.ca-stats-inner {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}

.ca-stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 12px;
  position: relative;
  transition: background 0.2s ease;
}

.ca-stat-item + .ca-stat-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  height: 60%;
  width: 1px;
  background: var(--vp-c-divider);
}

.ca-stat-item:hover {
  background: var(--vp-c-brand-soft);
}

.ca-stat-value {
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
}

.ca-stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 5px;
}

@media (max-width: 480px) {
  .ca-stat-value { font-size: 1.25rem; }
  .ca-stat-item { padding: 14px 8px; }
}
</style>
