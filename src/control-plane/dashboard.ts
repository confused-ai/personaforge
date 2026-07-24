/**
 * @personaforge/control-plane/dashboard — Full GUI dashboard for agent management.
 *
 * Serves a single-page HTML/CSS/JS dashboard with:
 * - Session browser with search + detail view
 * - Memory inspector with entity graph
 * - Eval runs with pass/fail charts
 * - Trace waterfall visualization
 * - HITL approval queue
 * - Knowledge base browser
 * - Chat playground with streaming
 * - Graph workflow visualizer (DAG via simple SVG)
 *
 * This module reads dashboard.html from disk at startup.
 * For production, bundle dashboard.html into the build.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let _html: string | null = null;

export function loadDashboardHtml(): string {
  if (_html) return _html;

  // Try filesystem first (dev mode)
  const dir = dirname(fileURLToPath(import.meta.url));
  const paths = [
    join(dir, 'dashboard.html'),
    join(process.cwd(), 'src', 'control-plane', 'dashboard.html'),
    join(process.cwd(), 'dist', 'dashboard.html'),
  ];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        _html = readFileSync(p, 'utf-8');
        return _html!;
      }
    } catch { /* try next */ }
  }

  // Inline fallback — minimal bootstrap that loads from CDN-like pattern
  _html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>personaforge</title>
<style>body{font-family:system-ui,sans-serif;background:#13141f;color:#e0e0e8;margin:0}
.panel{display:none}.panel.active{display:block}
</style></head><body>
<div id="root"><div class="panel active"><h1>Loading dashboard...</h1></div></div>
<script>
(async()=>{
  const api = p => fetch('/api/'+p).then(r=>r.json());
  const d = await api('dashboard-bundle');
  if(d.html){ document.getElementById('root').innerHTML = d.html; }
})();
</script></body></html>`;
  return _html!;
}
