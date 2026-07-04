<script setup lang="ts"></script>

<template>
  <div class="ca-announce-wrap">
    <a href="/changelog" class="ca-announce">
      <span class="ca-ann-badge">NEW</span>
      <span class="ca-ann-text">v2.4 — Durable graph engine · Mastermind compression · MCP server</span>
      <svg class="ca-ann-arrow" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 6.5h11M7.5 2l4.5 4.5L7.5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
  </div>
</template>

<style scoped>
.ca-announce-wrap {
  display: flex;
  justify-content: center;
  padding: 28px 24px 0;
  position: relative;
  z-index: 1;
}

.ca-announce {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 6px 16px 6px 6px;
  border-radius: 100px;
  border: 1px solid rgba(20, 184, 166, 0.3);
  background: rgba(20, 184, 166, 0.07);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-decoration: none;
  transition: all 0.22s ease;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.ca-announce:hover {
  border-color: rgba(20, 184, 166, 0.65);
  color: var(--vp-c-brand-1);
  background: rgba(20, 184, 166, 0.13);
  box-shadow: 0 0 24px rgba(20, 184, 166, 0.12);
}

.ca-ann-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 100px;
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.ca-ann-text {
  flex: 1;
}

.ca-ann-arrow {
  opacity: 0.55;
  transition: transform 0.2s ease, opacity 0.2s ease;
  flex-shrink: 0;
}

.ca-announce:hover .ca-ann-arrow {
  transform: translateX(3px);
  opacity: 1;
}
</style>
