/**
 * Hermetic coverage for src/context — types, backend, provider gaps.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect } from 'vitest';
import {
    ContextMode,
    ContextBackend,
    ContextProvider,
    type Answer,
    type Document,
    type QueryOptions,
} from '../src/context/index.js';

describe('context/types ContextMode', () => {
    it('exposes DEFAULT/AGENT/TOOLS', () => {
        expect(ContextMode.DEFAULT).toBe('default');
        expect(ContextMode.AGENT).toBe('agent');
        expect(ContextMode.TOOLS).toBe('tools');
    });
});

describe('context/backend', () => {
    class NamedBackend extends ContextBackend {
        readonly name = 'named';
    }

    it('default lifecycle, status, tools, toString', async () => {
        const b = new NamedBackend();
        await b.setup();
        await b.close();
        expect(b.status()).toEqual({ ok: true });
        expect(await b.astatus()).toEqual({ ok: true });
        expect(b.getTools()).toEqual([]);
        expect(b.toString()).toBe('ContextBackend(named)');
    });
});

describe('context/provider', () => {
    class StaticProvider extends ContextProvider {
        docs: Document[] = [{ id: '1', name: 'Doc', content: 'hello world' }];

        async query(q: string, _opts?: QueryOptions): Promise<Answer> {
            const results = this.docs.filter((d) => (d.content ?? '').includes(q));
            return { results, text: String(results.length) };
        }
    }

    class UpdatableProvider extends ContextProvider {
        docs: Document[] = [];

        async query(): Promise<Answer> {
            return { results: this.docs };
        }

        override async update(documents: Document[]): Promise<void> {
            this.docs = documents;
        }
    }

    it('constructor defaults and custom tool names/metadata', () => {
        const p = new StaticProvider({ name: 'docs' });
        expect(p.mode).toBe(ContextMode.DEFAULT);
        expect(p.queryToolName).toBe('docs_query');
        expect(p.updateToolName).toBe('docs_update');
        expect(p.metadata).toEqual({});
        expect(p.instructions()).toBeUndefined();

        const p2 = new StaticProvider({
            name: 'x',
            mode: ContextMode.AGENT,
            instructions: 'use me',
            queryToolName: 'q',
            updateToolName: 'u',
            metadata: { k: 1 },
        });
        expect(p2.mode).toBe(ContextMode.AGENT);
        expect(p2.queryToolName).toBe('q');
        expect(p2.updateToolName).toBe('u');
        expect(p2.metadata).toEqual({ k: 1 });
        expect(p2.instructions()).toBe('use me');
        expect(p2.toString()).toBe('ContextProvider(name=x, mode=agent)');
    });

    it('getTools includes update only when subclass overrides update', async () => {
        const staticP = new StaticProvider({ name: 's', mode: ContextMode.TOOLS });
        expect(staticP.getTools()).toHaveLength(1);

        const up = new UpdatableProvider({ name: 'u', mode: ContextMode.TOOLS });
        const tools = up.getTools();
        expect(tools).toHaveLength(2);
        expect(tools[1]!.name).toBe('u_update');

        await tools[0]!.fn('hello');
        await tools[1]!.fn([{ id: '2', name: 'n', content: 'c' }]);
        expect(up.docs).toHaveLength(1);

        await expect(staticP.update([])).rejects.toThrow(/update\(\) not supported/);
    });

    it('astatus mirrors status; setup/close toggle ready detail', async () => {
        const p = new StaticProvider({ name: 'life' });
        expect((await p.astatus()).ok).toBe(true);
        await p.setup();
        expect(p.status().detail).toContain('ready=true');
        await p.close();
        expect(p.status().detail).toContain('ready=false');
    });
});
