<script setup lang="ts">
import { ref } from 'vue';

const copied = ref(false);

function copy() {
  navigator.clipboard.writeText('npm install confused-ai').then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}
</script>

<template>
  <section class="ca-cta-section">
    <!-- Ambient glow orbs -->
    <div class="ca-cta-orb ca-cta-orb-l" aria-hidden="true" />
    <div class="ca-cta-orb ca-cta-orb-r" aria-hidden="true" />

    <div class="ca-cta-inner">
      <!-- Label -->
      <div class="ca-cta-eyebrow">READY TO SHIP?</div>

      <h2 class="ca-cta-title">Start building in<br><span class="ca-cta-grad">30 seconds</span></h2>
      <p class="ca-cta-sub">
        One package. From prototype to enterprise without changing frameworks.
      </p>

      <!-- Install command with copy button -->
      <div class="ca-cta-install">
        <span class="ca-cta-dollar" aria-hidden="true">$</span>
        <code class="ca-cta-cmd">npm install confused-ai</code>
        <button class="ca-cta-copy" :aria-label="copied ? 'Copied' : 'Copy'" @click="copy">
          <svg v-if="!copied" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>

      <div class="ca-cta-actions">
        <a href="/guide/getting-started" class="ca-btn-primary">
          Get Started →
        </a>
        <a href="https://github.com/confused-ai/confused-ai" target="_blank" rel="noopener" class="ca-btn-ghost">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          View on GitHub
        </a>
      </div>

      <div class="ca-cta-trust">
        <span>MIT License</span>
        <span class="ca-dot">·</span>
        <span>No telemetry by default</span>
        <span class="ca-dot">·</span>
        <span>TypeScript-first</span>
        <span class="ca-dot">·</span>
        <span>Zero lock-in</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ── Section: always dark ───────────────────────────────── */
.ca-cta-section {
  position: relative;
  padding: 120px 24px 100px;
  overflow: hidden;
  text-align: center;
  background: #08060f;
  border-top: 1px solid rgba(20, 184, 166, 0.18);
}

/* Ambient glow orbs */
.ca-cta-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(80px);
  opacity: 0.35;
}

.ca-cta-orb-l {
  width: 480px;
  height: 480px;
  background: radial-gradient(circle, #0d9488, transparent 70%);
  top: -100px;
  left: -120px;
}

.ca-cta-orb-r {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #3b82f6, transparent 70%);
  bottom: -80px;
  right: -100px;
}

/* ── Inner ─────────────────────────────────────────────── */
.ca-cta-inner {
  position: relative;
  z-index: 1;
  max-width: 620px;
  margin: 0 auto;
}

/* ── Eyebrow ────────────────────────────────────────────── */
.ca-cta-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #2dd4bf;
  margin-bottom: 20px;
}

/* ── Title ──────────────────────────────────────────────── */
.ca-cta-title {
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.1;
  color: #f0eeff;
  margin-bottom: 18px;
  border-top: none !important;
  padding-top: 0 !important;
}

.ca-cta-grad {
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Subtitle ───────────────────────────────────────────── */
.ca-cta-sub {
  font-size: 1.05rem;
  color: rgba(240, 238, 255, 0.6);
  margin-bottom: 40px;
  line-height: 1.65;
}

/* ── Install box ────────────────────────────────────────── */
.ca-cta-install {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 13px 20px 13px 24px;
  border-radius: 12px;
  border: 1px solid rgba(20, 184, 166, 0.3);
  background: rgba(20, 184, 166, 0.08);
  margin-bottom: 36px;
  cursor: text;
}

.ca-cta-dollar {
  font-family: ui-monospace, 'Fira Code', monospace;
  font-size: 15px;
  color: rgba(45, 212, 191, 0.5);
  user-select: none;
}

.ca-cta-cmd {
  font-family: ui-monospace, 'Fira Code', monospace;
  font-size: 15px;
  color: #e2d9ff;
  letter-spacing: 0.02em;
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.ca-cta-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid rgba(20, 184, 166, 0.25);
  background: rgba(20, 184, 166, 0.1);
  color: rgba(45, 212, 191, 0.7);
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;
}

.ca-cta-copy:hover {
  border-color: rgba(20, 184, 166, 0.5);
  background: rgba(20, 184, 166, 0.2);
  color: #2dd4bf;
}

/* ── Action buttons ─────────────────────────────────────── */
.ca-cta-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 40px;
}

.ca-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 13px 30px;
  border-radius: 11px;
  background: linear-gradient(135deg, #14b8a6 0%, #3b82f6 100%);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  text-decoration: none;
  letter-spacing: 0.01em;
  transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 0 0 0 rgba(20, 184, 166, 0);
}

.ca-btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-2px);
  box-shadow: 0 10px 36px rgba(20, 184, 166, 0.5);
}

.ca-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 26px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(240, 238, 255, 0.85);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.04);
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.ca-btn-ghost:hover {
  border-color: rgba(45, 212, 191, 0.45);
  background: rgba(20, 184, 166, 0.1);
  color: #e2d9ff;
}

/* ── Trust strip ────────────────────────────────────────── */
.ca-cta-trust {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12.5px;
  color: rgba(240, 238, 255, 0.3);
  letter-spacing: 0.01em;
}

.ca-dot {
  opacity: 0.3;
}
</style>
