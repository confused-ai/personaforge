/**
 * @personaforge/optimize — programmatic prompt optimization (DSPy-style).
 *
 * Implements **bootstrap few-shot**, the core DSPy primitive: instead of
 * hand-writing examples, you provide a training set and a scorer, and the
 * optimizer runs the base instruction over the train inputs, keeps the cases the
 * model gets right (score ≥ threshold), and compiles those into a few-shot
 * prompt. The result is a reusable, self-tuned prompt — no manual demo curation.
 *
 * ```ts
 * const optimized = await bootstrapFewShot({
 *   instruction: 'Classify the sentiment as positive or negative.',
 *   trainset: [
 *     { input: 'I love this',  expected: 'positive' },
 *     { input: 'This is awful', expected: 'negative' },
 *   ],
 *   generate: (prompt) => llm.generateText(prompt).then(r => r.text),
 *   scorer: (expected, actual) => actual.trim().toLowerCase() === expected ? 1 : 0,
 * });
 *
 * const prompt = optimized.render('Worst purchase ever'); // instruction + demos + input
 * ```
 */

/** A labelled training example. */
export interface OptimizeExample<I = string> {
    input: I;
    expected: string;
}

/** A selected few-shot demonstration. */
export interface Demo<I = string> {
    input: I;
    output: string;
}

/** Scores an actual answer against the expected one. Return 0…1. */
export type OptimizeScorer = (expected: string, actual: string) => number;

/** Calls the model with a fully-rendered prompt and returns its text. */
export type GenerateFn = (prompt: string) => Promise<string>;

export interface BootstrapConfig<I = string> {
    /** Base task instruction. */
    instruction: string;
    /** Labelled examples to bootstrap demos from. */
    trainset: OptimizeExample<I>[];
    /** Model call used to produce candidate answers. */
    generate: GenerateFn;
    /** Scorer deciding whether a bootstrapped answer is good enough to keep. */
    scorer: OptimizeScorer;
    /** Max demos to compile into the optimized prompt. Default 4. */
    maxDemos?: number;
    /** Minimum score for a demo to be kept. Default 0.5. */
    threshold?: number;
    /** Render an input as prompt text. Default `String(input)`. */
    formatInput?: (input: I) => string;
}

/** The compiled, self-tuned prompt. */
export interface OptimizedPrompt<I = string> {
    instruction: string;
    demos: Demo<I>[];
    /** Fraction of the trainset that passed the threshold (bootstrap yield). */
    yield: number;
    /** Render the full few-shot prompt for a new input. */
    render(input: I): string;
}

function defaultFormat<I>(input: I): string {
    return typeof input === 'string' ? input : JSON.stringify(input);
}

/**
 * Bootstrap a few-shot prompt from labelled data. For each training example the
 * base instruction is run; examples the model answers correctly (per `scorer`)
 * become demos, up to `maxDemos`. The gold `expected` is used as each demo's
 * output, so compiled demos are always correct even when the raw model answer
 * was only close.
 */
export async function bootstrapFewShot<I = string>(config: BootstrapConfig<I>): Promise<OptimizedPrompt<I>> {
    const {
        instruction,
        trainset,
        generate,
        scorer,
        maxDemos = 4,
        threshold = 0.5,
        formatInput = defaultFormat,
    } = config;

    const demos: Demo<I>[] = [];
    let passed = 0;

    for (const example of trainset) {
        const probe = `${instruction}\n\nInput: ${formatInput(example.input)}\nOutput:`;
        let actual: string;
        try {
            actual = (await generate(probe)).trim();
        } catch {
            continue; // a failed generation simply yields no demo
        }
        if (scorer(example.expected, actual) >= threshold) {
            passed++;
            if (demos.length < maxDemos) {
                demos.push({ input: example.input, output: example.expected });
            }
        }
    }

    const render = (input: I): string => renderFewShot(instruction, demos, formatInput, input);

    return {
        instruction,
        demos,
        yield: trainset.length === 0 ? 0 : passed / trainset.length,
        render,
    };
}

/** Compose instruction + demos + a new input into a single prompt string. */
export function renderFewShot<I>(
    instruction: string,
    demos: Demo<I>[],
    formatInput: (input: I) => string,
    input: I,
): string {
    const parts = [instruction];
    if (demos.length > 0) {
        const examples = demos
            .map((d) => `Input: ${formatInput(d.input)}\nOutput: ${d.output}`)
            .join('\n\n');
        parts.push(`Examples:\n${examples}`);
    }
    parts.push(`Input: ${formatInput(input)}\nOutput:`);
    return parts.join('\n\n');
}
