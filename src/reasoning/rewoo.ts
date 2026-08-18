/**
 * ReWOO Engine (Reasoning Without Observation)
 * ============================================
 * Implements ReWOO (Wang et al. 2023).
 * Decouples reasoning (planning) from tool execution:
 *   1. Planner creates a full step-by-step execution graph with variable placeholders (`#E1`, `#E2`, ...).
 *   2. Workers execute tools in sequence/parallel, populating `#E` variable values.
 *   3. Solver receives the goal, completed execution log, and variable outputs to generate final synthesis.
 */

export interface ReWooStep {
    /** Variable token e.g. "#E1" */
    id: string;
    /** Tool name to execute */
    tool: string;
    /** Input argument string or payload */
    input: string;
    /** Resolved output after tool execution */
    result?: string;
    /** Status of execution */
    status: 'pending' | 'completed' | 'failed';
    /** Error message if execution failed */
    error?: string;
}

export interface ReWooConfig {
    /** LLM callable used for Planner and Solver steps */
    generate: (messages: Array<{ role: string; content: string }>) => Promise<string>;
    /** Tool execution function (toolName, inputString) -> string output */
    executeTool: (toolName: string, input: string) => Promise<string>;
    /** Custom planner prompt */
    plannerPrompt?: string;
    /** Custom solver prompt */
    solverPrompt?: string;
}

export interface ReWooResult {
    /** Final solution synthesized by the Solver */
    solution: string;
    /** Executed plan steps with variable assignments */
    plan: ReWooStep[];
    /** Execution log map: `#E1` -> result */
    variableMap: Record<string, string>;
    /** Total tools executed successfully */
    successCount: number;
}

const DEFAULT_PLANNER_PROMPT = `You are a ReWOO Planner.
Given a task, break it down into sequential tool execution steps using variable placeholders.
Output ONLY a JSON array of step objects matching this format:
[
  { "id": "#E1", "tool": "toolName", "input": "input with optional #E placeholders" },
  { "id": "#E2", "tool": "anotherTool", "input": "use output from #E1" }
]
Rules:
- Assign variable IDs strictly as #E1, #E2, #E3...
- Keep inputs clean and declarative.`;

const DEFAULT_SOLVER_PROMPT = `You are a ReWOO Solver.
Given the original goal and the executed tool evidence, synthesize a complete and clear final answer.`;

export class ReWooEngine {
    private readonly _generate: ReWooConfig['generate'];
    private readonly _executeTool: ReWooConfig['executeTool'];
    private readonly _plannerPrompt: string;
    private readonly _solverPrompt: string;

    constructor(config: ReWooConfig) {
        this._generate     = config.generate;
        this._executeTool = config.executeTool;
        this._plannerPrompt = config.plannerPrompt ?? DEFAULT_PLANNER_PROMPT;
        this._solverPrompt  = config.solverPrompt  ?? DEFAULT_SOLVER_PROMPT;
    }

    async solve(goal: string, context?: string): Promise<ReWooResult> {
        // 1. Planner phase: generate execution graph with #E variables
        const plannerMsg = [
            `Goal: ${goal}`,
            context ? `Context: ${context}` : '',
            'Generate the execution plan:',
        ].filter(Boolean).join('\n\n');

        const rawPlan = await this._generate([
            { role: 'system', content: this._plannerPrompt },
            { role: 'user',   content: plannerMsg },
        ]).catch(() => '[]');

        const plan = this._parsePlan(rawPlan);
        const variableMap: Record<string, string> = {};
        let successCount = 0;

        // 2. Execution phase: run worker steps, replacing variable references
        for (const step of plan) {
            // Substitute variable references in step input (e.g. #E1 -> actual output)
            let boundInput = step.input;
            for (const [varId, varVal] of Object.entries(variableMap)) {
                boundInput = boundInput.replaceAll(varId, varVal);
            }

            try {
                const res = await this._executeTool(step.tool, boundInput);
                step.result = res;
                step.status = 'completed';
                variableMap[step.id] = res;
                successCount++;
            } catch (err) {
                step.result = `Error: ${String(err)}`;
                step.status = 'failed';
                step.error  = String(err);
                variableMap[step.id] = step.result;
            }
        }

        // 3. Solver phase: synthesize solution from evidence
        const evidenceLog = plan
            .map((s) => `${s.id} (${s.tool}) => ${s.result}`)
            .join('\n');

        const solverMsg = [
            `Goal: ${goal}`,
            context ? `Context: ${context}` : '',
            `Tool Execution Evidence:\n${evidenceLog}`,
            'Synthesize final answer:',
        ].filter(Boolean).join('\n\n');

        const solution = await this._generate([
            { role: 'system', content: this._solverPrompt },
            { role: 'user',   content: solverMsg },
        ]).catch((err) => `Failed to synthesize answer: ${String(err)}`);

        return {
            solution,
            plan,
            variableMap,
            successCount,
        };
    }

    private _parsePlan(raw: string): ReWooStep[] {
        try {
            const match = raw.match(/\[[\s\S]*\]/);
            if (match) {
                const parsed = JSON.parse(match[0]) as Array<{ id?: string; tool?: string; input?: string }>;
                if (Array.isArray(parsed)) {
                    return parsed.map((item, idx) => ({
                        id: typeof item.id === 'string' ? item.id : `#E${idx + 1}`,
                        tool: typeof item.tool === 'string' ? item.tool : 'default_tool',
                        input: typeof item.input === 'string' ? item.input : '',
                        status: 'pending',
                    }));
                }
            }
        } catch {
            /* fall through */
        }

        // Fallback: line-by-line parsing if JSON parse failed
        const lines = raw.split('\n').filter((l) => l.includes('#E') || l.includes(':'));
        return lines.map((line, idx) => ({
            id: `#E${idx + 1}`,
            tool: 'exec',
            input: line.trim(),
            status: 'pending',
        }));
    }
}
