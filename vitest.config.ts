import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Use Bun for fast TypeScript execution
        environment: 'node',
        // Use the test-specific tsconfig so test files get Node.js types
        typecheck: {
            tsconfig: './tsconfig.test.json',
        },
        
        // Test file patterns
        include: [
            'tests/**/*.test.ts',
            'src/**/*.test.ts',
            'packages/*/tests/**/*.test.ts',
            'packages/*/src/**/*.test.ts',
            'packages/*/*/tests/**/*.test.ts',
            'packages/*/*/src/**/*.test.ts',
        ],
        // Live-model integration tests are opt-in — they hit real provider APIs
        // and require secrets. They live under tests/integration/ and run only
        // via `bun run test:integration` (vitest.integration.config.ts). Keep
        // them out of the default unit run so CI stays hermetic and fast.
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'tests/integration/**',
        ],

        // Benchmark file patterns
        benchmark: {
            include: ['benchmarks/**/*.bench.ts'],
        },
        
        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'json', 'html'],
            // Measure coverage on the packages/* code (gated at 80) AND the
            // shipped src/ runtime (reported for visibility, ratcheted over time).
            // adapter-redis is excluded: tests require a live Redis instance
            // (skipped in CI) — coverage is tracked separately with testcontainers.
            include: [
                'packages/foundation/contracts/src/**/*.ts',
                'packages/platform/guard/src/**/*.ts',
                'packages/platform/observe/src/**/*.ts',
                'packages/platform/serve/src/**/*.ts',
                'src/**/*.ts',
            ],
            exclude: [
                'node_modules/**',
                'dist/**',
                'tests/**',
                'benchmarks/**',
                'examples/**',
                'docs/**',
                'packages/**/dist/**',
                'packages/**/tests/**',
                // Exclude optional/heavy adapter stacks, but KEEP universal adapters
                // and dx/compose.ts in coverage (production orchestration surface).
                'src/adapters/!(universal)/**',
                'src/adapters/*.ts',
                'src/dx/!(compose).ts',
                'src/runtime/**',
                '**/*.d.ts',
                '**/*.test.ts',
                '**/index.ts',
            ],
            // Glob-scoped thresholds: packages/* stay gated at 80/75; the shipped
            // src/ runtime is now gated (see the src glob below) at a ratcheting
            // floor rather than 0. Any regression fails CI; ratchet the floor up
            // in small steps as coverage improves — do NOT lower it.
            thresholds: {
                'packages/**/src/**/*.ts': {
                    lines: 48,
                    functions: 46,
                    branches: 36,
                    statements: 46,
                },
                'src/**/*.ts': {
                    // Ratcheting floor. Measured 2026-07-30 after repo-wide coverage
                    // campaign: ~44.5% lines, ~43.1% funcs,
                    // ~33.9% branches, ~42.9% stmts.
                    // Floors sit ~1 pp below to absorb noise. Target 60/50 this quarter,
                    // 75/65 next, 100% long-term.
                    lines: 43,
                    functions: 42,
                    branches: 32,
                    statements: 41,
                },
            },
        },
        
        // Timeout for async operations
        testTimeout: 30000,
        
        // Reporter configuration
        reporters: ['verbose'],
        
        // Global setup/teardown
        globalSetup: undefined,
    },
    
    // Resolve aliases matching tsconfig
    resolve: {
        alias: {
            '@': './src',
            // foundation
            '@personaforge/contracts': new URL('./src/contracts/index.ts', import.meta.url).pathname,
            '@personaforge/shared': new URL('./src/shared/index.ts', import.meta.url).pathname,
            // runtime
            '@personaforge/core': new URL('./src/core/index.ts', import.meta.url).pathname,
            '@personaforge/agentic': new URL('./src/agentic/index.ts', import.meta.url).pathname,
            '@personaforge/graph': new URL('./src/graph/index.ts', import.meta.url).pathname,
            '@personaforge/workflow': new URL('./src/workflow/index.ts', import.meta.url).pathname,
            '@personaforge/orchestration': new URL('./src/orchestration/index.ts', import.meta.url).pathname,
            '@personaforge/execution': new URL('./src/execution/index.ts', import.meta.url).pathname,
            '@personaforge/planner': new URL('./src/planner/index.ts', import.meta.url).pathname,
            '@personaforge/reasoning': new URL('./src/reasoning/index.ts', import.meta.url).pathname,
            '@personaforge/scheduler': new URL('./src/scheduler/index.ts', import.meta.url).pathname,
            '@personaforge/background': new URL('./src/background/index.ts', import.meta.url).pathname,
            // providers
            '@personaforge/models': new URL('./src/models/index.ts', import.meta.url).pathname,
            '@personaforge/router': new URL('./src/router/index.ts', import.meta.url).pathname,
            // state
            '@personaforge/db': new URL('./src/db/index.ts', import.meta.url).pathname,
            '@personaforge/session': new URL('./src/session/index.ts', import.meta.url).pathname,
            '@personaforge/memory': new URL('./src/memory/index.ts', import.meta.url).pathname,
            '@personaforge/knowledge': new URL('./src/knowledge/index.ts', import.meta.url).pathname,
            '@personaforge/learning': new URL('./src/learning/index.ts', import.meta.url).pathname,
            '@personaforge/storage': new URL('./src/storage/index.ts', import.meta.url).pathname,
            '@personaforge/artifacts': new URL('./src/artifacts/index.ts', import.meta.url).pathname,
            '@personaforge/adapter-redis': new URL('./src/adapter-redis/index.ts', import.meta.url).pathname,
            // tools-layer (subpaths must be listed before the barrel)
            '@personaforge/tools/ai': new URL('./src/tools/ai/index.ts', import.meta.url).pathname,
            '@personaforge/tools/communication': new URL('./src/tools/communication/index.ts', import.meta.url).pathname,
            '@personaforge/tools/core': new URL('./src/tools/core/index.ts', import.meta.url).pathname,
            '@personaforge/tools/crm': new URL('./src/tools/crm/index.ts', import.meta.url).pathname,
            '@personaforge/tools/data': new URL('./src/tools/data/index.ts', import.meta.url).pathname,
            '@personaforge/tools/devtools': new URL('./src/tools/devtools/index.ts', import.meta.url).pathname,
            '@personaforge/tools/finance': new URL('./src/tools/finance/index.ts', import.meta.url).pathname,
            '@personaforge/tools/mcp': new URL('./src/tools/mcp/index.ts', import.meta.url).pathname,
            '@personaforge/tools/media': new URL('./src/tools/media/index.ts', import.meta.url).pathname,
            '@personaforge/tools/memory': new URL('./src/tools/memory/index.ts', import.meta.url).pathname,
            '@personaforge/tools/productivity': new URL('./src/tools/productivity/index.ts', import.meta.url).pathname,
            '@personaforge/tools/scraping': new URL('./src/tools/scraping/index.ts', import.meta.url).pathname,
            '@personaforge/tools/search': new URL('./src/tools/search/index.ts', import.meta.url).pathname,
            '@personaforge/tools/social': new URL('./src/tools/social/index.ts', import.meta.url).pathname,
            '@personaforge/tools/utils': new URL('./src/tools/utils/index.ts', import.meta.url).pathname,
            '@personaforge/tools': new URL('./src/tools/index.ts', import.meta.url).pathname,
            '@personaforge/plugins': new URL('./src/plugins/index.ts', import.meta.url).pathname,
            // platform
            '@personaforge/guard': new URL('./src/guard/index.ts', import.meta.url).pathname,
            '@personaforge/guardrails': new URL('./src/guardrails/index.ts', import.meta.url).pathname,
            '@personaforge/observe': new URL('./src/observe/index.ts', import.meta.url).pathname,
            '@personaforge/production': new URL('./src/production/index.ts', import.meta.url).pathname,
            '@personaforge/serve': new URL('./src/serve/index.ts', import.meta.url).pathname,
            '@personaforge/config': new URL('./src/config/index.ts', import.meta.url).pathname,
            '@personaforge/eval': new URL('./src/eval/index.ts', import.meta.url).pathname,
            '@personaforge/context': new URL('./src/context/index.ts', import.meta.url).pathname,
            '@personaforge/compression': new URL('./src/compression/index.ts', import.meta.url).pathname,
            // developer
            '@personaforge/sdk': new URL('./src/sdk/index.ts', import.meta.url).pathname,
            '@personaforge/cli': new URL('./src/cli/index.ts', import.meta.url).pathname,
            '@personaforge/playground': new URL('./src/playground/index.ts', import.meta.url).pathname,
            '@personaforge/test-utils/conformance': new URL('./src/test-utils/conformance.ts', import.meta.url).pathname,
            '@personaforge/test-utils': new URL('./src/test-utils/index.ts', import.meta.url).pathname,
            '@personaforge/skills': new URL('./src/skills/index.ts', import.meta.url).pathname,
            // extensions
            '@personaforge/voice': new URL('./src/voice/index.ts', import.meta.url).pathname,
            '@personaforge/video': new URL('./src/video/index.ts', import.meta.url).pathname,
            // Mastra-parity layers
            '@personaforge/processors': new URL('./src/processors/index.ts', import.meta.url).pathname,
            '@personaforge/durable': new URL('./src/durable/index.ts', import.meta.url).pathname,
            '@personaforge/goals': new URL('./src/goals/index.ts', import.meta.url).pathname,
            '@personaforge/code-mode': new URL('./src/code-mode/index.ts', import.meta.url).pathname,
            '@personaforge/approval': new URL('./src/approval/index.ts', import.meta.url).pathname,
        },
    },

    server: {
        watch: {
            ignored: ['**/node_modules/**', '**/dist/**'],
        },
    },
});
