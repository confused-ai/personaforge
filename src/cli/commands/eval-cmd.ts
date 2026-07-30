import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `personaforge eval <dataset> --agent <file>` — run an eval suite from CLI.
 *
 * Dataset format (JSON):
 * [{ "input": "What is 2+2?", "expected": "4" }, ...]
 *
 * The agent file must export `agent` or default a CreateAgentResult.
 *
 * @example
 * personaforge eval ./evals/qa.json --agent ./my-agent.ts
 * personaforge eval ./evals/qa.json --agent ./my-agent.ts --threshold 0.8 --output ./results.json
 */
export function registerEvalCommand(program: Command): void {
    program
        .command('eval')
        .description('Run an eval dataset against an agent and report accuracy')
        .argument('<dataset>', 'Path to JSON eval dataset [{input, expected}]')
        .requiredOption('-a, --agent <file>', 'Agent file to evaluate')
        .option('-t, --threshold <number>', 'Fail if score drops below this (0-1)', '0.7')
        .option('-m, --max <number>', 'Max samples to run', '100')
        .option('-o, --output <file>', 'Write results JSON to file')
        .option('--model <model>', 'LLM-as-judge model (default: gpt-4o)', 'gpt-4o')
        .action(async (datasetPath, options) => {
            const resolved = path.resolve(datasetPath);
            const agentFile = path.resolve(options.agent as string);
            const threshold = parseFloat(options.threshold as string);
            const maxSamples = parseInt(options.max as string, 10);

            // Load dataset
            let dataset: Array<{ input: string; expected?: string }>;
            try {
                const raw = fs.readFileSync(resolved, 'utf8');
                dataset = JSON.parse(raw) as typeof dataset;
            } catch {
                console.error(`Cannot read dataset: ${resolved}`);
                process.exit(1);
                return;
            }

            if (!Array.isArray(dataset) || dataset.length === 0) {
                console.error('Dataset must be a non-empty JSON array.');
                process.exit(1);
                return;
            }

            const samples = dataset.slice(0, maxSamples);

            // Load agent
            type AgentLike = { run: (prompt: string) => Promise<{ text: string }> };
            const mod = await import(pathToFileURL(agentFile).href) as Record<string, unknown>;
            const agent: AgentLike | undefined =
                (mod['agent'] as AgentLike | undefined) ??
                (mod['default'] as AgentLike | undefined);

            if (!agent || typeof agent.run !== 'function') {
                console.error(`No agent export found in ${agentFile}. Export \`agent\` or default.`);
                process.exit(1);
                return;
            }

            console.log(`\nRunning eval: ${samples.length} samples from ${path.basename(resolved)}`);
            console.log(`Agent: ${agentFile}\n`);

            const results: Array<{
                input: string;
                expected?: string;
                actual: string;
                passed: boolean;
                error?: string;
            }> = [];

            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i]!;
                process.stdout.write(`  [${i + 1}/${samples.length}] `);
                try {
                    const result = await agent.run(sample.input);
                    const actual = result.text.trim();
                    const passed = sample.expected
                        ? actual.toLowerCase().includes(sample.expected.toLowerCase())
                        : true; // no expected = always pass (latency-only mode)
                    results.push({
                        input: sample.input,
                        ...(sample.expected !== undefined && { expected: sample.expected }),
                        actual,
                        passed,
                    });
                    process.stdout.write(passed ? '✓\n' : '✗\n');
                } catch (err) {
                    results.push({
                        input: sample.input,
                        ...(sample.expected !== undefined && { expected: sample.expected }),
                        actual: '',
                        passed: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    process.stdout.write('✗ (error)\n');
                }
            }

            const passed = results.filter((r) => r.passed).length;
            const score = passed / results.length;

            console.log(`\n── Results ───────────────────────────────────────────`);
            console.log(`  Total:  ${results.length}`);
            console.log(`  Passed: ${passed}`);
            console.log(`  Failed: ${results.length - passed}`);
            console.log(`  Score:  ${(score * 100).toFixed(1)}%`);
            console.log(`  Threshold: ${(threshold * 100).toFixed(0)}%`);

            const report = { score, passed, total: results.length, threshold, results };

            if (options.output) {
                const outPath = path.resolve(options.output as string);
                fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
                console.log(`\n  Report written: ${outPath}`);
            }

            if (score < threshold) {
                console.error(`\n❌  Eval failed: score ${(score * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(0)}%`);
                process.exit(1);
                return;
            } else {
                console.log(`\n✅  Eval passed (${(score * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%)`);
            }
        });
}
