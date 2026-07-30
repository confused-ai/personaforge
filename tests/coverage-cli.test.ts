/**
 * Hermetic coverage for src/cli — buildProgram + command action handlers.
 * Mocks process.exit, fs/network, SqliteEventStore; spies on console.
 * Discovered by vitest via the tests include glob. No production imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { GraphEventType } from '../src/graph/types.js';

const mockStore = {
    init: vi.fn(async () => undefined),
    load: vi.fn(async () => [] as unknown[]),
    loadAfter: vi.fn(async () => [] as unknown[]),
};

vi.mock('../src/graph/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/graph/index.js')>();
    return {
        ...actual,
        SqliteEventStore: vi.fn(function SqliteEventStore() {
            return mockStore;
        }),
    };
});

vi.mock('node:https', () => ({
    default: {
        request: (_opts: unknown, cb: (res: { statusCode: number; resume: () => void }) => void) => {
            const req = new EventEmitter() as EventEmitter & {
                setTimeout: (ms: number, fn: () => void) => void;
                end: () => void;
                destroy: (err?: Error) => void;
            };
            req.setTimeout = () => undefined;
            req.end = () => {
                queueMicrotask(() => {
                    cb({ statusCode: 200, resume: () => undefined });
                });
            };
            req.destroy = (err?: Error) => {
                if (err) req.emit('error', err);
            };
            return req;
        },
    },
}));

import { buildProgram } from '../src/cli/build-program.js';

function makeProgram() {
    const program = buildProgram();
    program.exitOverride();
    for (const cmd of program.commands) {
        cmd.exitOverride();
    }
    return program;
}

async function runCli(args: string[]) {
    const program = makeProgram();
    await program.parseAsync(args, { from: 'user' });
    return program;
}

describe('buildProgram', () => {
    it('registers expected subcommands', () => {
        const names = makeProgram().commands.map((c) => c.name()).sort();
        expect(names).toEqual(
            expect.arrayContaining([
                'create',
                'run',
                'serve',
                'eval',
                'test',
                'validate',
                'plan',
                'execute',
                'list-templates',
                'doctor',
                'replay',
                'inspect',
                'export',
                'diff',
                'chat',
            ]),
        );
    });
});

describe('list-templates / test / plan / execute / validate', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let tmp: string;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cli-'));
    });

    afterEach(() => {
        log.mockRestore();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('list-templates prints template names', async () => {
        await runCli(['list-templates']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toContain('basic');
        expect(out).toContain('http');
    });

    it('test logs pattern and options', async () => {
        await runCli(['test', 'unit', '--watch', '--coverage']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toMatch(/Pattern: unit/);
        expect(out).toMatch(/Watch: true/);
        expect(out).toMatch(/Coverage: true/);
    });

    it('plan prints JSON and can write --output', async () => {
        await runCli(['plan', 'ship feature']);
        expect(log.mock.calls.some((c) => String(c[0]).includes('"goal"'))).toBe(true);

        const outFile = path.join(tmp, 'plan.json');
        await runCli(['plan', 'goal', '-o', outFile, '-p', 'llm']);
        const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { planner: string; goal: string };
        expect(written.goal).toBe('goal');
        expect(written.planner).toBe('llm');
    });

    it('execute dry-runs a plan file', async () => {
        const planFile = path.join(tmp, 'p.json');
        fs.writeFileSync(planFile, JSON.stringify({ steps: [{ id: 'a', description: 'do a' }] }));
        await runCli(['execute', planFile, '--parallel', '-c', '2']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toContain('[a] do a');
        expect(out).toContain('Executed 1 plan steps');
    });

    it('validate accepts a valid config file', async () => {
        const cfg = path.join(tmp, 'agent.json');
        fs.writeFileSync(
            cfg,
            JSON.stringify({ name: 'a', instructions: 'be helpful', model: 'gpt-4o', maxSteps: 3 }),
        );
        await runCli(['validate', cfg]);
        expect(log.mock.calls.some((c) => String(c[0]).includes('Valid config'))).toBe(true);
    });

    it('validate rejects invalid config', async () => {
        const cfg = path.join(tmp, 'bad.json');
        fs.writeFileSync(cfg, JSON.stringify({ name: '' }));
        await expect(runCli(['validate', cfg])).rejects.toThrow();
    });
});

describe('create', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let err: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let tmp: string;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-create-'));
    });

    afterEach(() => {
        log.mockRestore();
        err.mockRestore();
        exitSpy.mockRestore();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('scaffolds basic template and skips existing files', async () => {
        const dir = path.join(tmp, 'my-agent');
        await runCli(['create', 'MyAgent', '-t', 'basic', '-d', dir]);
        expect(fs.existsSync(path.join(dir, 'agent.ts'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);

        await runCli(['create', 'MyAgent', '-t', 'basic', '-d', dir]);
        expect(log.mock.calls.some((c) => String(c[0]).includes('skipped'))).toBe(true);
    });

    it('scaffolds http template', async () => {
        const dir = path.join(tmp, 'http-agent');
        await runCli(['create', 'HttpAgent', '-t', 'http', '-d', dir]);
        expect(fs.existsSync(path.join(dir, 'agent.ts'))).toBe(true);
    });

    it('exits on unknown template', async () => {
        await runCli(['create', 'x', '-t', 'nope', '-d', path.join(tmp, 'x')]);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(err.mock.calls.some((c) => String(c[0]).includes('Unknown template'))).toBe(true);
    });
});

describe('doctor', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
        log.mockRestore();
        warn.mockRestore();
        exitSpy.mockRestore();
        delete process.env['OPENAI_API_KEY'];
    });

    it('runs checks and exits 1 when no API keys', async () => {
        delete process.env['OPENAI_API_KEY'];
        delete process.env['ANTHROPIC_API_KEY'];
        delete process.env['GOOGLE_AI_API_KEY'];
        delete process.env['OPENROUTER_API_KEY'];
        delete process.env['AWS_ACCESS_KEY_ID'];
        await runCli(['doctor']);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(warn.mock.calls.length + log.mock.calls.length).toBeGreaterThan(0);
    });

    it('passes when a key is set', async () => {
        process.env['OPENAI_API_KEY'] = 'sk-test-key-1234';
        await runCli(['doctor']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toMatch(/All checks passed|OpenAI/);
    });
});

describe('replay / inspect / export / diff (mocked store)', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let writeSpy: ReturnType<typeof vi.spyOn>;

    const events = [
        {
            sequence: 1,
            timestamp: 1_000,
            type: GraphEventType.EXECUTION_STARTED,
            nodeId: undefined,
            data: undefined,
        },
        {
            sequence: 2,
            timestamp: 1_100,
            type: GraphEventType.NODE_STARTED,
            nodeId: 'node-alpha-123456',
            data: { attempt: 1 },
        },
        {
            sequence: 3,
            timestamp: 1_500,
            type: GraphEventType.NODE_COMPLETED,
            nodeId: 'node-alpha-123456',
            data: { durationMs: 400 },
        },
        {
            sequence: 4,
            timestamp: 1_600,
            type: GraphEventType.NODE_FAILED,
            nodeId: 'node-beta-999',
            data: { error: 'boom' },
        },
        {
            sequence: 5,
            timestamp: 1_650,
            type: GraphEventType.NODE_SKIPPED,
            nodeId: 'node-skip',
            data: undefined,
        },
        {
            sequence: 6,
            timestamp: 1_700,
            type: GraphEventType.NODE_RETRYING,
            nodeId: 'node-retry',
            data: undefined,
        },
        {
            sequence: 7,
            timestamp: 2_000,
            type: GraphEventType.EXECUTION_COMPLETED,
            nodeId: undefined,
            data: undefined,
        },
    ];

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        mockStore.init.mockClear();
        mockStore.load.mockReset();
        mockStore.loadAfter.mockReset();
        mockStore.load.mockResolvedValue(events);
        mockStore.loadAfter.mockResolvedValue(events.slice(2));
    });

    afterEach(() => {
        log.mockRestore();
        vi.restoreAllMocks();
        writeSpy.mockRestore();
    });

    it('replay prints timeline and supports --json / --from', async () => {
        await runCli(['replay', '--run-id', 'r1']);
        expect(log.mock.calls.some((c) => String(c[0]).includes('Run:'))).toBe(true);

        await runCli(['replay', '--run-id', 'r1', '--json']);
        expect(log.mock.calls.some((c) => String(c[0]).includes('execution.started'))).toBe(true);

        await runCli(['replay', '--run-id', 'r1', '--from', '2']);
        expect(mockStore.loadAfter).toHaveBeenCalled();
    });

    it('replay exits when empty', async () => {
        mockStore.load.mockResolvedValue([]);
        await runCli(['replay', '--run-id', 'missing']);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('inspect prints node table', async () => {
        await runCli(['inspect', '--run-id', 'r1']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toContain('COMPLETED');
        expect(out).toContain('STATUS');
    });

    it('inspect exits when empty', async () => {
        mockStore.load.mockResolvedValue([]);
        await runCli(['inspect', '--run-id', 'missing']);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('export writes stdout or file', async () => {
        await runCli(['export', '--run-id', 'r1', '--out', '-']);
        expect(writeSpy).toHaveBeenCalled();

        const outFile = path.join(os.tmpdir(), `pf-export-${Date.now()}.json`);
        await runCli(['export', '--run-id', 'r1', '--out', outFile, '--pretty']);
        expect(fs.existsSync(outFile)).toBe(true);
        fs.unlinkSync(outFile);
    });

    it('export exits when empty', async () => {
        mockStore.load.mockResolvedValue([]);
        await runCli(['export', '--run-id', 'missing']);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('diff compares two runs', async () => {
        const eventsB = [
            { ...events[0], sequence: 1 },
            {
                sequence: 2,
                timestamp: 1_100,
                type: GraphEventType.NODE_STARTED,
                nodeId: 'node-alpha-123456',
                data: { attempt: 1 },
            },
            {
                sequence: 3,
                timestamp: 1_200,
                type: GraphEventType.NODE_FAILED,
                nodeId: 'node-alpha-123456',
                data: {},
            },
            {
                sequence: 4,
                timestamp: 1_300,
                type: GraphEventType.NODE_STARTED,
                nodeId: 'only-in-b',
                data: {},
            },
        ];
        mockStore.load.mockImplementation(async (id: string) => (id === 'a' ? events : eventsB));
        await runCli(['diff', '--run-id-a', 'a', '--run-id-b', 'b']);
        const out = log.mock.calls.map((c) => String(c[0])).join('\n');
        expect(out).toContain('divergent');
        expect(process.exitCode).toBe(1);
        process.exitCode = 0;
    });

    it('diff exits when run A or B missing', async () => {
        mockStore.load.mockResolvedValueOnce([]).mockResolvedValueOnce(events);
        await runCli(['diff', '--run-id-a', 'a', '--run-id-b', 'b']);
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockClear();
        mockStore.load.mockResolvedValueOnce(events).mockResolvedValueOnce([]);
        await runCli(['diff', '--run-id-a', 'a', '--run-id-b', 'b']);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

describe('run / eval (temp modules)', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let tmp: string;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-run-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('run invokes exported run()', async () => {
        const file = path.join(tmp, 'agent.mjs');
        fs.writeFileSync(file, `export async function run(input) { return 'hello:' + input; }\n`);
        await runCli(['run', file, '-i', 'world']);
        expect(log.mock.calls.some((c) => String(c[0]).includes('hello:world'))).toBe(true);
    });

    it('run uses default export', async () => {
        const file = path.join(tmp, 'def.mjs');
        fs.writeFileSync(file, `export default async function (input) { return 'd:' + input; }\n`);
        await runCli(['run', file, '-i', 'x']);
        expect(log.mock.calls.some((c) => String(c[0]).includes('d:x'))).toBe(true);
    });

    it('run throws when no runnable export', async () => {
        const file = path.join(tmp, 'empty.mjs');
        fs.writeFileSync(file, `export const x = 1;\n`);
        await expect(runCli(['run', file])).rejects.toThrow(/No runnable export/);
    });

    it('eval scores dataset against agent', async () => {
        const agent = path.join(tmp, 'eval-agent.mjs');
        const dataset = path.join(tmp, 'ds.json');
        fs.writeFileSync(
            agent,
            `export const agent = { run: async (input) => ({ text: input.includes('2+2') ? '4' : 'no' }) };\n`,
        );
        fs.writeFileSync(
            dataset,
            JSON.stringify([
                { input: 'What is 2+2?', expected: '4' },
                { input: 'hi', expected: 'hello' },
            ]),
        );
        const outReport = path.join(tmp, 'report.json');
        await runCli(['eval', dataset, '-a', agent, '-t', '0.4', '-o', outReport]);
        expect(fs.existsSync(outReport)).toBe(true);
        expect(log.mock.calls.some((c) => String(c[0]).includes('Eval passed') || String(c[0]).includes('Score'))).toBe(
            true,
        );
    });

    it('eval exits on bad dataset / missing agent / low score', async () => {
        await runCli(['eval', path.join(tmp, 'missing.json'), '-a', path.join(tmp, 'a.mjs')]);
        expect(exitSpy).toHaveBeenCalledWith(1);

        const empty = path.join(tmp, 'empty.json');
        fs.writeFileSync(empty, '[]');
        exitSpy.mockClear();
        await runCli(['eval', empty, '-a', path.join(tmp, 'a.mjs')]);
        expect(exitSpy).toHaveBeenCalledWith(1);

        const agent = path.join(tmp, 'bad-agent.mjs');
        const dataset = path.join(tmp, 'ds2.json');
        fs.writeFileSync(agent, `export const nope = 1;\n`);
        fs.writeFileSync(dataset, JSON.stringify([{ input: 'a', expected: 'b' }]));
        exitSpy.mockClear();
        await runCli(['eval', dataset, '-a', agent]);
        expect(exitSpy).toHaveBeenCalledWith(1);

        const agent2 = path.join(tmp, 'fail-agent.mjs');
        fs.writeFileSync(agent2, `export default { run: async () => ({ text: 'wrong' }) };\n`);
        exitSpy.mockClear();
        await runCli(['eval', dataset, '-a', agent2, '-t', '0.99']);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
