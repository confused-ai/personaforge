#!/usr/bin/env node
/**
 * scripts/check-bundle-size.mjs
 *
 * Bundles a public personaforge entry point with esbuild, gzips the output,
 * and fails (exit 1) if the gzip size exceeds the configured gate.
 *
 * Heavy optional deps (playwright, pg, openai, anthropic, ioredis, …) are
 * treated as externals — they must NOT appear in the bundle.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs
 *   node scripts/check-bundle-size.mjs --entry src/lite.ts --max-kb 50
 */

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

const entryArg = getArgValue('--entry') ?? process.env.BUNDLE_ENTRY ?? 'src/index.ts';
const labelArg = getArgValue('--label') ?? process.env.BUNDLE_LABEL ?? entryArg;
const maxKbArg = getArgValue('--max-kb') ?? process.env.BUNDLE_MAX_KB ?? '80';

const MAX_GZIP_BYTES = Number(maxKbArg) * 1024;

// Known heavy optional peers — must never land in the bundle.
const EXTERNAL = [
  '@anthropic-ai/sdk',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-secrets-manager',
  '@aws-sdk/client-sqs',
  '@azure/identity',
  '@azure/keyvault-secrets',
  '@ffmpeg-installer/ffmpeg',
  '@google-cloud/secret-manager',
  '@google/generative-ai',
  '@sendgrid/mail',
  'amqplib',
  'better-sqlite3',
  'bullmq',
  'chromadb',
  'duck-duck-scrape',
  'fluent-ffmpeg',
  'ioredis',
  'js-tiktoken',
  'kafkajs',
  'mysql2',
  'mysql2/promise',
  'neo4j-driver',
  'nodemailer',
  'ollama',
  'openai',
  'pdf-parse',
  'pexels',
  'playwright',
  'playwright-core',
  'pg',
  'pg-native',
  'stripe',
  'twilio',
  'yahoo-finance2',
];

const entry = resolve(ROOT, entryArg);

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: true,
  write: false,
  external: EXTERNAL,
  // Suppress warnings about dynamic imports (expected in optional-dep pattern).
  logLevel: 'error',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

const code = result.outputFiles[0].contents;
const gzipped = gzipSync(code);
const gzipKb = (gzipped.byteLength / 1024).toFixed(1);
const rawKb = (code.byteLength / 1024).toFixed(1);

const limitKb = (MAX_GZIP_BYTES / 1024).toFixed(0);
const status = gzipped.byteLength <= MAX_GZIP_BYTES ? '✓ PASS' : '✗ FAIL';

console.log(`Bundle size check (${labelArg})`);
console.log(`  Raw:    ${rawKb} kB`);
console.log(`  Gzip:   ${gzipKb} kB  (limit: ${limitKb} kB)  ${status}`);

if (gzipped.byteLength > MAX_GZIP_BYTES) {
  console.error(
    `\nBundle exceeds the ${limitKb} kB gzip limit by ` +
    `${((gzipped.byteLength - MAX_GZIP_BYTES) / 1024).toFixed(1)} kB.\n` +
    `Check for accidental inclusion of heavy dependencies in ${labelArg}.\n` +
    `Tip: run with BUNDLE_MAX_KB=<new-limit> to temporarily raise the gate.`,
  );
  process.exit(1);
}
