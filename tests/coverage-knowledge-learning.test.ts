/**
 * Hermetic coverage for knowledge loaders/stores + learning Db* stores.
 * Callers: vitest only (tests include glob).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadJson } from '../src/knowledge/loaders/json-loader.js';
import { loadCsv } from '../src/knowledge/loaders/csv-loader.js';
import { loadMarkdown, loadMarkdownText } from '../src/knowledge/loaders/markdown-loader.js';
import { loadHtml, loadHtmlText } from '../src/knowledge/loaders/html-loader.js';
import {
    DbKnowledgeEngine,
    createDbKnowledgeEngine,
    DbVectorStore,
} from '../src/knowledge/db-knowledge-store.js';
import { InMemoryAgentDb } from '../src/db/in-memory.js';
import {
    DbUserMemoryStore,
    DbSessionContextStore,
    DbLearnedKnowledgeStore,
    DbEntityMemoryStore,
    DbDecisionLogStore,
} from '../src/learning/db-learning-stores.js';

describe('knowledge loaders', () => {
    let dir: string;
    afterEach(() => {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('loadJson / jsonl / contentField', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-know-'));
        const jsonPath = path.join(dir, 'a.json');
        fs.writeFileSync(jsonPath, JSON.stringify([{ text: 'hello', id: 1 }, { text: 'world' }]));
        const docs = await loadJson(jsonPath, { contentField: 'text', metadata: { t: 1 } });
        expect(docs).toHaveLength(2);
        expect(docs[0]?.content).toBe('hello');

        const single = path.join(dir, 'b.json');
        fs.writeFileSync(single, JSON.stringify({ text: 'solo' }));
        expect((await loadJson(single)).length).toBe(1);

        const jsonl = path.join(dir, 'c.jsonl');
        fs.writeFileSync(jsonl, '{"a":1}\n{"a":2}\n');
        expect((await loadJson(jsonl)).length).toBe(2);
    });

    it('loadCsv with content column and defaults', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-csv-'));
        const p = path.join(dir, 'd.csv');
        fs.writeFileSync(p, 'sku,description,category\nA1,"nice product",tools\nA2,,misc\n');
        const docs = await loadCsv(p, {
            contentColumn: 'description',
            metadataColumns: ['sku', 'category'],
            metadata: { src: 'test' },
        });
        expect(docs.length).toBe(1);
        expect(docs[0]?.content).toBe('nice product');
        expect(docs[0]?.metadata['sku']).toBe('A1');

        const all = await loadCsv(p);
        expect(all.length).toBeGreaterThanOrEqual(1);

        const empty = path.join(dir, 'e.csv');
        fs.writeFileSync(empty, 'h1,h2\n');
        expect(await loadCsv(empty)).toEqual([]);
    });

    it('loadMarkdown / loadMarkdownText / html', async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-md-'));
        const md = path.join(dir, 'x.md');
        fs.writeFileSync(md, '# Title\nbody\n## Sub\nmore\n');
        const sections = await loadMarkdown(md);
        expect(sections.length).toBeGreaterThanOrEqual(2);
        expect(loadMarkdownText('no headings just text').length).toBe(1);

        const html = path.join(dir, 'x.html');
        fs.writeFileSync(html, '<html><script>x</script><style>y</style><p>Hi &amp; bye</p></html>');
        const doc = await loadHtml(html);
        expect(doc[0]?.content).toContain('Hi & bye');
        expect(loadHtmlText('<b>Bold</b>').content).toBe('Bold');
    });
});

describe('DbKnowledgeEngine + DbVectorStore', () => {
    it('persists docs and builds context', async () => {
        const db = new InMemoryAgentDb();
        const engine = createDbKnowledgeEngine({
            db,
            linkedTo: 'ns1',
            embed: async (t) => [t.includes('blue') ? 1 : 0, 1],
            topK: 3,
        });
        await engine.addDocuments([
            { id: 'd1', content: 'The sky is blue.', metadata: { k: 1 } },
            { id: 'd2', content: 'Grass is green.', metadata: {} },
        ]);
        const ctx = await engine.buildContext('blue sky');
        expect(ctx.length).toBeGreaterThan(0);
        const retrieved = await engine.retrieve('blue', { limit: 2 });
        expect(retrieved.totalRetrieved).toBeGreaterThan(0);
        expect(engine.inner).toBeTruthy();

        const engine2 = new DbKnowledgeEngine({
            db,
            linkedTo: 'ns1',
            embed: async (t) => [t.includes('blue') ? 1 : 0, 1],
        });
        expect(await engine2.buildContext('blue')).toBeTruthy();

        const vs = new DbVectorStore(db, async (t) => [t.length, 1], 'ns1');
        await vs.add([{ id: 'd3', content: 'extra', metadata: {} }]);
        const hits = await vs.search('extra', 2);
        expect(hits.length).toBeGreaterThan(0);
    });
});

describe('Db learning stores', () => {
    it('DbUserMemoryStore CRUD', async () => {
        const db = new InMemoryAgentDb();
        const store = new DbUserMemoryStore(db);
        expect(await store.get('u1')).toBeNull();

        const id = await store.addMemory('u1', 'likes tea', 'a1', { tag: 'pref' });
        expect(await store.get('u1', 'a1')).toBeTruthy();
        expect(await store.updateMemory('u1', id, 'likes coffee', 'a1')).toBe(true);
        expect(await store.updateMemory('u1', 'missing', 'x', 'a1')).toBe(false);
        expect(await store.deleteMemory('u1', id, 'a1')).toBe(true);
        expect(await store.deleteMemory('u1', id, 'a1')).toBe(false);
        await store.clearMemories('u1', 'a1');
        await store.clearMemories('nobody');

        await store.set({
            userId: 'u2',
            memories: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        expect(await store.get('u2')).toBeTruthy();
    });

    it('DbSessionContextStore + learned knowledge', async () => {
        const db = new InMemoryAgentDb();
        const sessions = new DbSessionContextStore(db);
        const ctx = {
            sessionId: 's1',
            agentId: 'a1',
            userId: 'u1',
            summary: 'ongoing',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await sessions.set(ctx);
        expect(await sessions.get('s1', 'a1')).toMatchObject({ summary: 'ongoing' });
        expect(await sessions.clear('s1', 'a1')).toBe(true);

        const knowledge = new DbLearnedKnowledgeStore(db);
        await knowledge.save({
            title: 'Tip',
            learning: 'Always test',
            context: 'qa',
            tags: ['test'],
            namespace: 'ns',
            agentId: 'a1',
            createdAt: new Date().toISOString(),
        });
        expect((await knowledge.search('test', 'ns')).length).toBe(1);
        expect((await knowledge.search('', 'ns')).length).toBe(1);
        expect(await knowledge.delete('Tip', 'ns')).toBe(true);
    });

    it('DbEntityMemoryStore + DbDecisionLogStore', async () => {
        const db = new InMemoryAgentDb();
        const entities = new DbEntityMemoryStore(db);
        await entities.set({
            entityId: 'e1',
            entityType: 'person',
            name: 'Ada',
            description: 'engineer',
            facts: [],
            events: [],
            relationships: [],
            namespace: 'ns',
            agentId: 'a1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const factId = await entities.addFact('e1', 'invented computer', 'ns');
        expect(await entities.updateFact('e1', factId, 'pioneered computing')).toBe(true);
        expect(await entities.updateFact('e1', 'nope', 'x')).toBe(false);
        expect((await entities.search('Ada', 'ns')).length).toBe(1);
        expect(await entities.deleteFact('e1', factId)).toBe(true);
        expect(await entities.get('e1', 'ns')).toBeTruthy();

        const decisions = new DbDecisionLogStore(db);
        const logged = await decisions.add({
            sessionId: 's1',
            agentId: 'a1',
            decision: 'chose A',
            reasoning: 'better',
            outcome: 'success',
        });
        expect((await decisions.list('a1', 's1')).length).toBeGreaterThan(0);
        expect(await decisions.get(logged.id)).toBeTruthy();
        expect((await decisions.search('chose', 'a1')).length).toBeGreaterThan(0);
        expect(await decisions.update(logged.id, { outcome: 'ok', outcomeQuality: 'good' })).toBe(true);
    });
});
