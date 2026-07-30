<script setup lang="ts">
const frameworks = [
  { key: 'ca', label: 'personaforge', highlight: true },
  { key: 'lc', label: 'LangChain.js' },
  { key: 'vai', label: 'Vercel AI SDK' },
  { key: 'crewai', label: 'CrewAI' },
  { key: 'langgraph', label: 'LangGraph' },
  { key: 'mastra', label: 'Mastra' },
  { key: 'agno', label: 'Agno' },
] as const;

const rows = [
  { feature: 'Zero-config progressive DX',    ca: true,  lc: 'partial', vai: true,  crewai: 'partial', langgraph: 'partial', mastra: 'partial', agno: 'partial' },
  { feature: 'First-class TypeScript',         ca: true,  lc: 'partial', vai: true,  crewai: false,    langgraph: 'partial', mastra: true,      agno: false     },
  { feature: '100+ built-in tools',            ca: true,  lc: true,      vai: false, crewai: 'partial', langgraph: false,    mastra: 'partial', agno: 'partial' },
  { feature: 'Multi-agent orchestration',      ca: true,  lc: true,      vai: false, crewai: true,      langgraph: true,      mastra: true,      agno: true      },
  { feature: 'Durable DAG graph engine',       ca: true,  lc: 'partial', vai: false, crewai: false,    langgraph: true,      mastra: false,     agno: 'partial' },
  { feature: 'Native MCP support',             ca: true,  lc: 'partial', vai: false, crewai: 'partial', langgraph: 'partial', mastra: true,      agno: 'partial' },
  { feature: 'OTLP distributed tracing',       ca: true,  lc: 'partial', vai: 'partial', crewai: false, langgraph: 'partial', mastra: 'partial', agno: false     },
  { feature: 'Circuit breakers & retries',     ca: true,  lc: false,     vai: false, crewai: false,    langgraph: 'partial', mastra: false,     agno: false     },
  { feature: 'USD budget enforcement',         ca: true,  lc: false,     vai: false, crewai: false,    langgraph: false,     mastra: false,     agno: false     },
  { feature: 'Multi-tenancy context',          ca: true,  lc: false,     vai: false, crewai: false,    langgraph: false,     mastra: false,     agno: false     },
  { feature: 'Audit logging',                  ca: true,  lc: false,     vai: false, crewai: false,    langgraph: false,     mastra: false,     agno: false     },
  { feature: 'Human-in-the-loop (HITL)',       ca: true,  lc: 'partial', vai: false, crewai: 'partial', langgraph: true,      mastra: 'partial', agno: 'partial' },
  { feature: 'Intelligent LLM router',         ca: true,  lc: false,     vai: false, crewai: false,    langgraph: false,     mastra: false,     agno: 'partial' },
  { feature: 'Automatic REST API',             ca: true,  lc: false,     vai: false, crewai: false,    langgraph: false,     mastra: 'partial', agno: 'partial' },
  { feature: 'Voice & video',                  ca: true,  lc: 'partial', vai: false, crewai: false,    langgraph: false,     mastra: false,     agno: false     },
];

type Cell = boolean | string;
type Row = typeof rows[number];

function icon(val: Cell) {
  if (val === true) return { text: '✓', cls: 'yes', title: 'Built-in' };
  if (val === false) return { text: '✗', cls: 'no', title: 'Not included' };
  return { text: '~', cls: 'partial', title: 'Partial or add-on' };
}

function cell(row: Row, key: string): Cell {
  return (row as Record<string, Cell>)[key];
}

defineProps<{ compact?: boolean; showLegend?: boolean }>();
</script>

<template>
  <div class="cm-root" :class="{ 'cm-compact': compact }">
    <div class="cm-scroll" role="region" aria-label="Framework capability comparison" tabindex="0">
      <table class="cm-table">
        <thead>
          <tr>
            <th class="cm-th cm-th-sticky cm-th-feat">Capability</th>
            <th
              v-for="fw in frameworks"
              :key="fw.key"
              class="cm-th"
              :class="{ 'cm-th-highlight': fw.highlight, 'cm-th-sticky-brand': fw.highlight }"
            >
              <span :class="{ 'cm-brand': fw.highlight }">{{ fw.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.feature" class="cm-tr">
            <td class="cm-td cm-td-sticky cm-td-feat">{{ row.feature }}</td>
            <td
              v-for="fw in frameworks"
              :key="fw.key"
              class="cm-td cm-td-val"
              :class="{ 'cm-td-highlight': fw.highlight }"
            >
              <span
                :class="['cm-icon', icon(cell(row, fw.key)).cls]"
                :title="icon(cell(row, fw.key)).title"
              >{{ icon(cell(row, fw.key)).text }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showLegend !== false" class="cm-legend">
      <span><span class="cm-icon yes">✓</span> Built-in</span>
      <span><span class="cm-icon partial">~</span> Partial / add-on</span>
      <span><span class="cm-icon no">✗</span> Not included</span>
      <span class="cm-scroll-hint">Scroll horizontally for all frameworks →</span>
    </div>
  </div>
</template>

<style scoped>
.cm-root {
  width: 100%;
}

.cm-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.cm-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.875rem;
}

.cm-th,
.cm-td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}

.cm-th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vp-c-bg-soft);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--vp-c-text-2);
  text-align: center;
  letter-spacing: 0.01em;
  text-transform: none;
}

.cm-th-feat {
  text-align: left;
  min-width: 220px;
}

.cm-th-highlight {
  background: rgba(15, 118, 110, 0.08);
}

.cm-brand {
  background: linear-gradient(135deg, #0f766e 0%, #0f4c81 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 800;
}

.dark .cm-brand {
  background: linear-gradient(135deg, #5eead4 0%, #60a5fa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.cm-th-sticky {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--vp-c-bg-soft);
  box-shadow: 2px 0 6px rgba(0,0,0,0.04);
}

.cm-th-sticky-brand {
  left: 220px;
  z-index: 4;
  box-shadow: 2px 0 6px rgba(0,0,0,0.04);
}

.cm-td-sticky {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--vp-c-bg);
  box-shadow: 2px 0 6px rgba(0,0,0,0.03);
}

.cm-td-feat {
  font-weight: 500;
  color: var(--vp-c-text-1);
  min-width: 220px;
  text-align: left;
}

.cm-td-val {
  text-align: center;
  min-width: 108px;
}

.cm-td-highlight {
  background: rgba(15, 118, 110, 0.04);
}

.cm-tr:last-child .cm-td {
  border-bottom: none;
}

.cm-tr:hover .cm-td {
  background: var(--vp-c-bg-soft);
}

.cm-tr:hover .cm-td-highlight {
  background: rgba(15, 118, 110, 0.07);
}

.cm-tr:hover .cm-td-sticky {
  background: var(--vp-c-bg-soft);
}

.cm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
}

.cm-icon.yes {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
}

.cm-icon.no {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.cm-icon.partial {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}

.cm-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.cm-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cm-scroll-hint {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

@media (max-width: 720px) {
  .cm-scroll-hint { margin-left: 0; width: 100%; }
}

.cm-compact .cm-th-feat,
.cm-compact .cm-td-feat { min-width: 180px; }
.cm-compact .cm-th-sticky-brand { left: 180px; }
</style>
