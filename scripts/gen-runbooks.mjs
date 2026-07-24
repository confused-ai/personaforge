#!/usr/bin/env node
// Generates LLM-ready runbook docs, one per public export subpath, grounded in
// real .d.ts symbols. Regenerate after API changes: `node scripts/gen-runbooks.mjs`.
// ponytail: prose templates are static; upgrade to per-feature curated tasks when a
// feature needs bespoke operational guidance beyond the generated surface.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const NAME = pkg.name;
const OUT = join(root, 'docs', 'runbooks');
const GUIDE_DIR = join(root, 'docs', 'guide');
const guides = existsSync(GUIDE_DIR)
  ? readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  : [];

const typesOf = (v) =>
  typeof v === 'string' ? null : v?.types || v?.import?.types || v?.require?.types || null;

const slug = (sub) => (sub === '.' ? 'index' : sub.replace(/^\.\//, '').replace(/\//g, '-'));
const title = (sub) =>
  sub === '.'
    ? 'Framework Core'
    : sub
        .replace(/^\.\//, '')
        .split('/')
        .map((p) => p.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()))
        .join(': ');

const RE = {
  fn: /^export (?:declare )?(?:async )?function ([A-Za-z0-9_$]+)/gm,
  cls: /^export (?:declare )?(?:abstract )?class ([A-Za-z0-9_$]+)/gm,
  iface: /^export interface ([A-Za-z0-9_$]+)/gm,
  type: /^export type ([A-Za-z0-9_$]+)/gm,
  konst: /^export (?:declare )?const ([A-Za-z0-9_$]+)/gm,
  en: /^export (?:declare )?enum ([A-Za-z0-9_$]+)/gm,
};
const grab = (src, re) => {
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
};

function resolveSrc(sub) {
  const base = sub === '.' ? 'index' : sub.replace(/^\.\//, '');
  const cands = [join(root, 'src', base, 'index.ts'), join(root, 'src', `${base}.ts`)];
  return cands.find((c) => existsSync(c)) || null;
}

function symbols(dtsRel, sub) {
  let p = join(root, dtsRel.replace(/^\.\//, ''));
  let from = dtsRel;
  if (!existsSync(p)) {
    const srcP = resolveSrc(sub);
    if (!srcP) return null;
    p = srcP;
    from = './' + srcP.slice(root.length + 1);
  }
  const src = readFileSync(p, 'utf8');
  return {
    _from: from,
    functions: grab(src, RE.fn),
    classes: grab(src, RE.cls),
    interfaces: grab(src, RE.iface),
    types: grab(src, RE.type),
    consts: grab(src, RE.konst),
    enums: grab(src, RE.en),
  };
}

// Pick a primary import symbol: prefer a factory (create*/define*/make*), else first class/fn/const.
function primary(s) {
  const all = [...s.functions, ...s.consts];
  const factory = all.find((n) => /^(create|define|make|build|new)[A-Z]/.test(n));
  return factory || s.functions[0] || s.classes[0] || s.consts[0] || s.interfaces[0] || null;
}

function matchGuide(sub) {
  const base = slug(sub);
  const cands = [base, base.replace(/^tools-/, ''), base.replace(/s$/, ''), base + 's'];
  return guides.find((g) => cands.includes(g)) || null;
}

function importLine(sub, s) {
  const names = [primary(s), ...s.functions, ...s.classes]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);
  const spec = sub === '.' ? NAME : `${NAME}/${sub.replace(/^\.\//, '')}`;
  if (!names.length) return `import '${spec}';`;
  return `import { ${names.join(', ')} } from '${spec}';`;
}

function surface(label, arr, cap = 12) {
  if (!arr.length) return '';
  const shown = arr.slice(0, cap).map((n) => `\`${n}\``).join(', ');
  const more = arr.length > cap ? `, …(+${arr.length - cap})` : '';
  return `- **${label}** — ${shown}${more}\n`;
}

function runbook(sub, dts, s) {
  const spec = sub === '.' ? NAME : `${NAME}/${sub.replace(/^\.\//, '')}`;
  const T = title(sub);
  const p = primary(s);
  const guide = matchGuide(sub);
  const total =
    s.functions.length + s.classes.length + s.interfaces.length + s.types.length + s.consts.length + s.enums.length;

  let md = '';
  md += `---\n`;
  md += `title: "Runbook: ${T}"\n`;
  md += `description: "Operational runbook for ${spec} — import, run, verify, recover. ${total} public symbols."\n`;
  md += `outline: [2, 3]\n`;
  md += `generated: true\n`;
  md += `---\n\n`;

  md += `# Runbook: ${T}\n\n`;
  md += `> Auto-generated from \`${dts}\`. Do not edit by hand — run \`node scripts/gen-runbooks.mjs\`.\n\n`;
  md += `**Import path:** \`${spec}\`  ·  **Public symbols:** ${total}` + (guide ? `  ·  **Guide:** [/guide/${guide}](../guide/${guide}.md)` : '') + `\n\n`;

  md += `## What it is\n`;
  md += `\`${spec}\` is a public entry point of ${NAME}. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).\n\n`;

  md += `## Install\n`;
  md += '```bash\n';
  md += `npm i ${NAME}\n`;
  md += `# or: bun add ${NAME} · pnpm add ${NAME} · yarn add ${NAME}\n`;
  md += '```\n\n';

  md += `## Import\n`;
  md += '```ts\n';
  md += importLine(sub, s) + '\n';
  md += '```\n\n';

  md += `## Public API surface\n`;
  const api =
    surface('Factories / functions', s.functions) +
    surface('Classes', s.classes) +
    surface('Constants', s.consts) +
    surface('Enums', s.enums) +
    surface('Interfaces', s.interfaces) +
    surface('Types', s.types);
  md += (api || '- _No named runtime exports; import for side effects or types._\n') + '\n';

  md += `## Minimal use\n`;
  if (p) {
    md += '```ts\n';
    md += importLine(sub, s) + '\n\n';
    md += `// \`${p}\` is the primary entry for this feature.\n`;
    md += `// See the guide/type signature for full options.\n`;
    md += `const ${/^[A-Z]/.test(p) ? 'instance' : 'result'} = ${/^[A-Z]/.test(p) ? 'new ' + p + '(/* opts */)' : p + '(/* opts */)'};\n`;
    md += '```\n\n';
  } else {
    md += `This entry exposes types/interfaces only. Import the symbols you need for typing:\n\n`;
    md += '```ts\n' + importLine(sub, s) + '\n```\n\n';
  }

  md += `## Verify it works\n`;
  md += `- Type-check: \`npx tsc --noEmit\` resolves \`${spec}\` with no missing-module error.\n`;
  md += `- Runtime: \`node -e "import('${spec}').then(m => console.log(Object.keys(m)))"\` lists the exports above.\n`;
  if (guide) md += `- Behavior: follow the runnable example in [/guide/${guide}](../guide/${guide}.md).\n`;
  md += '\n';

  md += `## Common failures\n`;
  md += `- \`Cannot find module '${spec}'\` — package not installed or stale build; run \`npm i ${NAME}\` and rebuild.\n`;
  md += `- \`Cannot find module '<peer>'\` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.\n`;
  md += `- Type errors after upgrade — check \`CHANGELOG.md\` for the symbol you import; names above are the current contract.\n\n`;

  md += `## Rollback\n`;
  md += `- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).\n`;
  md += `- Pin a known-good version: \`npm i ${NAME}@<version>\`.\n\n`;

  md += `## Related\n`;
  md += `- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)\n`;
  if (guide) md += `- Concept guide: [/guide/${guide}](../guide/${guide}.md)\n`;
  return md;
}

// ---- run ----
mkdirSync(OUT, { recursive: true });
const exps = pkg.exports || {};
const entries = [];
for (const sub of Object.keys(exps)) {
  if (sub.endsWith('.json') || sub.includes('*')) continue;
  const dts = typesOf(exps[sub]) || '';
  const s = symbols(dts, sub);
  if (!s) continue;
  entries.push({ sub, dts: s._from, s, slug: slug(sub) });
}
entries.sort((a, b) => a.slug.localeCompare(b.slug));

let written = 0;
for (const e of entries) {
  writeFileSync(join(OUT, `${e.slug}.md`), runbook(e.sub, e.dts, e.s));
  written++;
}

// index
let idx = `---\ntitle: "Runbooks"\ndescription: "Operational, LLM-ready runbooks for every ${NAME} feature."\ngenerated: true\n---\n\n`;
idx += `# Runbooks\n\nOne runbook per public export subpath. Each covers import, minimal use, verify, common failures, and rollback. Generated from \`.d.ts\` — regenerate with \`node scripts/gen-runbooks.mjs\`.\n\n`;
idx += `| Feature | Import | Symbols |\n|---|---|---|\n`;
for (const e of entries) {
  const spec = e.sub === '.' ? NAME : `${NAME}/${e.sub.replace(/^\.\//, '')}`;
  const n =
    e.s.functions.length + e.s.classes.length + e.s.interfaces.length + e.s.types.length + e.s.consts.length + e.s.enums.length;
  idx += `| [${title(e.sub)}](./${e.slug}.md) | \`${spec}\` | ${n} |\n`;
}
writeFileSync(join(OUT, 'index.md'), idx);

// llms.txt (llmstxt.org)
let llms = `# ${NAME}\n\n`;
llms += `> ${pkg.description}\n\n`;
llms += `TypeScript AI agent framework. Start with one package, add features via tree-shakeable subpath imports. Each runbook below is operational: import, minimal use, verify, failures, rollback.\n\n`;
llms += `## Runbooks\n\n`;
for (const e of entries) {
  const spec = e.sub === '.' ? NAME : `${NAME}/${e.sub.replace(/^\.\//, '')}`;
  llms += `- [Runbook: ${title(e.sub)}](runbooks/${e.slug}.md): \`${spec}\`\n`;
}
llms += `\n## Guides\n\n`;
for (const g of guides.sort()) llms += `- [${g}](guide/${g}.md)\n`;
llms += `\n## Optional\n\n- [README](README.md)\n- [ARCHITECTURE](ARCHITECTURE.md)\n- [CHANGELOG](CHANGELOG.md)\n`;
writeFileSync(join(root, 'docs', 'llms.txt'), llms);

console.log(`runbooks: ${written} → docs/runbooks/  ·  index + llms.txt written  ·  ${entries.length} features`);
