/**
 * More framework surface area **without** another full LLM tour:
 * production primitives, artifacts, knowledge text splitting, learning profiles,
 * eval accuracy helpers, and typed config.
 *
 * Run: `bun run example:potential`
 * Optional: `examples/.env` with OPENAI_API_KEY so `loadConfig()` validates.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { splitText } from 'personaforge/knowledge';
import { InMemoryArtifactStorage, createTextArtifact } from 'personaforge/artifacts';
import { InMemoryUserProfileStore } from 'personaforge';
import { CircuitBreaker, CircuitState } from 'personaforge/production';
import { RateLimiter } from 'personaforge/production';
import { ExactMatchAccuracy, LevenshteinAccuracy } from 'personaforge';
import { loadConfig } from 'personaforge/config';

loadEnv({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

function log(title: string) {
    console.log(`\n── ${title} ──\n`);
}

async function main() {
    console.log('personaforge — unlock more modules (no LLM call in this script)\n');

    log('Knowledge: splitText (chunking for RAG pipelines)');
    const chunks = splitText('Hello world. Second sentence here.', {
        chunkSize: 20,
        chunkOverlap: 4,
    });
    console.log('Chunks', chunks.length, ':', chunks);

    log('Production: CircuitBreaker');
    const cb = new CircuitBreaker({ name: 'demo', failureThreshold: 2, resetTimeoutMs: 1000 });
    const cr = await cb.execute(async () => 'ok' as const);
    console.log('State after success:', cr.state, 'value:', cr.value, '(closed =', CircuitState.CLOSED, ')');

    log('Production: RateLimiter');
    const rl = new RateLimiter({ name: 'demo', maxRequests: 5, intervalMs: 60_000, burstCapacity: 0 });
    console.log('tryAcquire x3:', rl.tryAcquire(), rl.tryAcquire(), rl.tryAcquire());

    log('Artifacts: InMemoryArtifactStorage + createTextArtifact');
    const store = new InMemoryArtifactStorage({});
    const saved = await store.save(
        createTextArtifact('note.txt', 'Persisted agent output', { type: 'document', tags: ['demo'] })
    );
    const back = await store.get<string>(saved.id);
    console.log('Saved id', saved.id, 'round-trip:', back?.content?.slice(0, 40));

    log('Learning: InMemoryUserProfileStore');
    const ups = new InMemoryUserProfileStore();
    const p = await ups.set({
        userId: 'u1',
        metadata: { theme: 'dark' },
    });
    const again = await ups.get('u1');
    console.log('Profile id', p.id, 'metadata.theme', again?.metadata['theme']);

    log('Observability: ExactMatch + Levenshtein accuracy');
    console.log('Exact match score:', ExactMatchAccuracy.score('yes', 'yes'));
    console.log('Levenshtein-ish score:', LevenshteinAccuracy.score('hello', 'hallo').toFixed(2));

    log('Config: loadConfig() from process.env');
    try {
        const cfg = loadConfig();
        console.log('llm.provider:', cfg.llm?.provider);
    } catch (e) {
        console.log('loadConfig:', e instanceof Error ? e.message : e);
    }

    console.log(
        '\nNext: `bun run example:showcase` (LLM + sessions + workflows + HTTP). Full map: CAPABILITIES.md\n'
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
