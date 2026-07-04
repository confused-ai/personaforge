<script setup lang="ts">
const rows = [
  { feature: 'Zero-Config Progressive DX',    ca: true,  lc: 'partial', vai: true,  mastra: 'partial' },
  { feature: 'First-Class TypeScript',         ca: true,  lc: 'partial', vai: true,  mastra: true      },
  { feature: '100+ Built-In Tools',            ca: true,  lc: true,      vai: false, mastra: 'partial' },
  { feature: 'Multi-Agent Orchestration',      ca: true,  lc: true,      vai: false, mastra: true      },
  { feature: 'Durable DAG Graph Engine',       ca: true,  lc: 'partial', vai: false, mastra: false     },
  { feature: 'Native MCP Support',             ca: true,  lc: 'partial', vai: false, mastra: true      },
  { feature: 'OTLP Distributed Tracing',       ca: true,  lc: 'partial', vai: 'partial', mastra: 'partial' },
  { feature: 'Circuit Breakers & Retries',     ca: true,  lc: false,     vai: false, mastra: false     },
  { feature: 'USD Budget Enforcement',         ca: true,  lc: false,     vai: false, mastra: false     },
  { feature: 'Multi-Tenancy Context',          ca: true,  lc: false,     vai: false, mastra: false     },
  { feature: 'SOC2/HIPAA Audit Logging',       ca: true,  lc: false,     vai: false, mastra: false     },
  { feature: 'Human-in-the-Loop (HITL)',       ca: true,  lc: 'partial', vai: false, mastra: 'partial' },
  { feature: 'Intelligent LLM Router',         ca: true,  lc: false,     vai: false, mastra: false     },
  { feature: 'Automatic REST API',             ca: true,  lc: false,     vai: false, mastra: 'partial' },
  { feature: 'Voice (TTS/STT) & Video',        ca: true,  lc: 'partial', vai: false, mastra: false     },
];

function icon(val: boolean | string) {
  if (val === true) return { text: '✓', cls: 'yes' };
  if (val === false) return { text: '✗', cls: 'no' };
  return { text: '~', cls: 'partial' };
}
</script>

<template>
  <section class="ca-compare-section">
    <div class="ca-compare-inner">
      <div class="ca-section-label">COMPETITIVE LANDSCAPE</div>
      <h2 class="ca-section-title">Enterprise-ready from day one</h2>
      <p class="ca-section-sub">
        No patchwork of add-ons. Every production concern is built-in and composable.
      </p>

      <div class="ca-table-wrap">
        <table class="ca-table">
          <thead>
            <tr>
              <th class="ca-th-feat">Capability</th>
              <th class="ca-th-ca"><span class="ca-col-brand">Confused-AI</span></th>
              <th>LangChain.js</th>
              <th>Vercel AI SDK</th>
              <th>Mastra</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.feature" class="ca-tr">
              <td class="ca-td-feat">{{ row.feature }}</td>
              <td class="ca-td-val ca-td-ca">
                <span :class="['ca-icon', icon(row.ca).cls]">{{ icon(row.ca).text }}</span>
              </td>
              <td class="ca-td-val">
                <span :class="['ca-icon', icon(row.lc).cls]">{{ icon(row.lc).text }}</span>
              </td>
              <td class="ca-td-val">
                <span :class="['ca-icon', icon(row.vai).cls]">{{ icon(row.vai).text }}</span>
              </td>
              <td class="ca-td-val">
                <span :class="['ca-icon', icon(row.mastra).cls]">{{ icon(row.mastra).text }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ca-compare-section {
  padding: 80px 24px;
  background: var(--vp-c-bg-soft);
}

.ca-compare-inner {
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

.ca-table-wrap {
  overflow-x: auto;
  border-radius: 14px;
  border: 1px solid var(--vp-c-divider);
}

.ca-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  text-align: left;
}

.ca-table th {
  padding: 14px 18px;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.ca-th-feat { min-width: 240px; }

.ca-th-ca {
  background: rgba(20, 184, 166, 0.06);
  border-left: 2px solid var(--vp-c-brand-1);
}

.ca-col-brand {
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 800;
}

.ca-tr:hover td {
  background: var(--vp-c-bg-soft);
}

.ca-td-feat {
  padding: 12px 18px;
  color: var(--vp-c-text-1);
  font-weight: 500;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ca-td-val {
  padding: 12px 18px;
  text-align: center;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ca-td-ca {
  background: rgba(20, 184, 166, 0.04);
  border-left: 2px solid rgba(20, 184, 166, 0.3);
}

.ca-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
}

.ca-icon.yes {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.ca-icon.no {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.ca-icon.partial {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}
</style>
