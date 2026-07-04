<script setup lang="ts">
const categories = [
  {
    icon: '🌐',
    name: 'HTTP & Web',
    tools: ['fetch', 'scrape', 'browser', 'crawl', 'sitemap'],
  },
  {
    icon: '💬',
    name: 'Communication',
    tools: ['email', 'Slack', 'Discord', 'Twilio', 'Telegram'],
  },
  {
    icon: '🗄️',
    name: 'Databases',
    tools: ['PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'MongoDB'],
  },
  {
    icon: '☁️',
    name: 'Cloud Storage',
    tools: ['S3', 'GCS', 'Azure Blob', 'Dropbox', 'Drive'],
  },
  {
    icon: '🔧',
    name: 'Dev Tools',
    tools: ['GitHub', 'GitLab', 'Jira', 'Linear', 'Notion'],
  },
  {
    icon: '🔍',
    name: 'Search & Data',
    tools: ['DuckDuckGo', 'Wikipedia', 'CSV', 'JSON', 'Excel'],
  },
  {
    icon: '💳',
    name: 'Payments',
    tools: ['Stripe', 'PayPal', 'invoices', 'subscriptions', 'refunds'],
  },
  {
    icon: '📁',
    name: 'File System',
    tools: ['read', 'write', 'copy', 'move', 'zip/unzip'],
  },
  {
    icon: '🧮',
    name: 'Compute & Math',
    tools: ['calculator', 'code runner', 'unit convert', 'date/time', 'cron'],
  },
];

const subpaths = [
  { path: 'confused-ai', desc: 'Main barrel export' },
  { path: 'confused-ai/tools', desc: '100+ built-in tools' },
  { path: 'confused-ai/orchestration', desc: 'Multi-agent patterns' },
  { path: 'confused-ai/knowledge', desc: 'RAG + vector store' },
  { path: 'confused-ai/session', desc: 'Session stores' },
  { path: 'confused-ai/guardrails', desc: 'Safety & validation' },
  { path: 'confused-ai/production', desc: 'Circuit breakers, rate limits' },
  { path: 'confused-ai/observability', desc: 'OTLP, logs, evals' },
  { path: 'confused-ai/runtime', desc: 'HTTP + WebSocket server' },
  { path: 'confused-ai/adapters', desc: '20-category adapters' },
  { path: 'confused-ai/testing', desc: 'Mocks & fixtures' },
  { path: 'confused-ai/contracts', desc: 'Shared types only' },
];
</script>

<template>
  <section class="ca-bat-section">
    <div class="ca-bat-inner">
      <div class="ca-section-label">BATTERIES INCLUDED</div>
      <h2 class="ca-section-title">100+ tools, zero assembly required</h2>
      <p class="ca-section-sub">
        Every tool is Zod-validated, tree-shakeable, and ready to drop into any agent.
        Import only what you need — each subpath is independently bundleable.
      </p>

      <!-- Tool category grid -->
      <div class="ca-bat-grid">
        <div v-for="cat in categories" :key="cat.name" class="ca-bat-card">
          <div class="ca-bat-card-top">
            <span class="ca-bat-icon">{{ cat.icon }}</span>
            <span class="ca-bat-name">{{ cat.name }}</span>
          </div>
          <div class="ca-bat-pills">
            <span v-for="tool in cat.tools" :key="tool" class="ca-bat-pill">{{ tool }}</span>
          </div>
        </div>
      </div>

      <!-- Subpath imports -->
      <div class="ca-subpath-wrap">
        <div class="ca-subpath-header">
          <span class="ca-subpath-title">Tree-shakeable subpath imports</span>
          <span class="ca-subpath-hint">Import only what you need</span>
        </div>
        <div class="ca-subpath-grid">
          <div v-for="sp in subpaths" :key="sp.path" class="ca-subpath-row">
            <code class="ca-subpath-code">{{ sp.path }}</code>
            <span class="ca-subpath-desc">{{ sp.desc }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ca-bat-section {
  padding: 80px 24px;
}

.ca-bat-inner {
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
  max-width: 640px;
  margin-left: auto;
  margin-right: auto;
}

/* Category grid */
.ca-bat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 48px;
  text-align: left;
}

@media (max-width: 768px) {
  .ca-bat-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .ca-bat-grid { grid-template-columns: 1fr; }
}

.ca-bat-card {
  padding: 20px;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.ca-bat-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 8px 28px rgba(20, 184, 166, 0.1);
}

.ca-bat-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.ca-bat-icon {
  font-size: 1.25rem;
  line-height: 1;
}

.ca-bat-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.ca-bat-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ca-bat-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 100px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  letter-spacing: 0.01em;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.ca-bat-card:hover .ca-bat-pill {
  border-color: rgba(20, 184, 166, 0.3);
  color: var(--vp-c-text-1);
}

/* Subpath table */
.ca-subpath-wrap {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  overflow: hidden;
  text-align: left;
}

.ca-subpath-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(20, 184, 166, 0.06);
  border-bottom: 1px solid var(--vp-c-divider);
}

.ca-subpath-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ca-subpath-hint {
  font-size: 11px;
  color: var(--vp-c-text-3);
  letter-spacing: 0.04em;
}

.ca-subpath-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
}

@media (max-width: 600px) {
  .ca-subpath-grid { grid-template-columns: 1fr; }
}

.ca-subpath-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 11px 20px;
  border-bottom: 1px solid var(--vp-c-divider);
  transition: background 0.16s ease;
}

.ca-subpath-row:last-child,
.ca-subpath-row:nth-last-child(2):nth-child(odd) {
  border-bottom: none;
}

.ca-subpath-row:hover {
  background: var(--vp-c-brand-soft);
}

.ca-subpath-code {
  font-family: ui-monospace, 'Fira Code', monospace;
  font-size: 11.5px;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
  flex-shrink: 0;
  background: transparent;
  padding: 0;
}

.ca-subpath-desc {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
