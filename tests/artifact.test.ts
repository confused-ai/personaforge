/**
 * Artifact System Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    InMemoryArtifactStorage,
    createTextArtifact,
    createMarkdownArtifact,
    createDataArtifact,
    createReasoningArtifact,
    createPlanArtifact,
} from '@personaforge/artifacts';
import type { ArtifactStorage } from '@personaforge/artifacts';

describe('InMemoryArtifactStorage', () => {
    let storage: ArtifactStorage;

    beforeEach(() => {
        storage = new InMemoryArtifactStorage();
    });

    describe('save', () => {
        it('should save an artifact and return with generated ID', async () => {
            const artifact = createTextArtifact('test.txt', 'Hello, World!');
            const saved = await storage.save(artifact);

            expect(saved.id).toBeDefined();
            expect(saved.id).toMatch(/^art_/);
            expect(saved.name).toBe('test.txt');
            expect(saved.content).toBe('Hello, World!');
            expect(saved.version).toBe(1);
            expect(saved.createdAt).toBeInstanceOf(Date);
        });
    });

    describe('get', () => {
        it('should retrieve a saved artifact', async () => {
            const artifact = createTextArtifact('test.txt', 'content');
            const saved = await storage.save(artifact);

            const retrieved = await storage.get(saved.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.id).toBe(saved.id);
            expect(retrieved?.content).toBe('content');
        });

        it('should return null for non-existent artifact', async () => {
            const retrieved = await storage.get('non-existent');
            expect(retrieved).toBeNull();
        });
    });

    describe('update', () => {
        it('should update an artifact with new version', async () => {
            const artifact = createTextArtifact('test.txt', 'v1');
            const saved = await storage.save(artifact);

            const updated = await storage.update(saved.id, { content: 'v2' });

            expect(updated.version).toBe(2);
            expect(updated.content).toBe('v2');
        });

        it('should throw for non-existent artifact', async () => {
            await expect(
                storage.update('non-existent', { content: 'test' })
            ).rejects.toThrow('Artifact not found');
        });
    });

    describe('versioning', () => {
        it('should list all versions of an artifact', async () => {
            const artifact = createTextArtifact('test.txt', 'v1');
            const saved = await storage.save(artifact);
            await storage.update(saved.id, { content: 'v2' });
            await storage.update(saved.id, { content: 'v3' });

            const versions = await storage.listVersions(saved.id);

            expect(versions).toHaveLength(3);
            expect(versions[0].version).toBe(1);
            expect(versions[2].version).toBe(3);
        });

        it('should get a specific version', async () => {
            const artifact = createTextArtifact('test.txt', 'v1');
            const saved = await storage.save(artifact);
            await storage.update(saved.id, { content: 'v2' });

            const v1 = await storage.getVersion(saved.id, 1);
            const v2 = await storage.getVersion(saved.id, 2);

            expect(v1?.content).toBe('v1');
            expect(v2?.content).toBe('v2');
        });
    });

    describe('delete', () => {
        it('should delete an artifact', async () => {
            const artifact = createTextArtifact('test.txt', 'content');
            const saved = await storage.save(artifact);

            const deleted = await storage.delete(saved.id);
            const retrieved = await storage.get(saved.id);

            expect(deleted).toBe(true);
            expect(retrieved).toBeNull();
        });

        it('should return false for non-existent artifact', async () => {
            const deleted = await storage.delete('non-existent');
            expect(deleted).toBe(false);
        });
    });

    describe('list', () => {
        it('should list all artifacts', async () => {
            await storage.save(createTextArtifact('a.txt', 'a'));
            await storage.save(createTextArtifact('b.txt', 'b'));

            const list = await storage.list();

            expect(list).toHaveLength(2);
        });

        it('should filter by type', async () => {
            await storage.save(createTextArtifact('file.txt', 'text'));
            await storage.save(createMarkdownArtifact('doc.md', '# Heading'));

            const markdownOnly = await storage.list({ type: 'markdown' });

            expect(markdownOnly).toHaveLength(1);
            expect(markdownOnly[0].type).toBe('markdown');
        });

        it('should filter by tags', async () => {
            await storage.save(createTextArtifact('a.txt', 'a', { tags: ['project-a'] }));
            await storage.save(createTextArtifact('b.txt', 'b', { tags: ['project-b'] }));

            const projectA = await storage.list({ tags: ['project-a'] });

            expect(projectA).toHaveLength(1);
            expect(projectA[0].name).toBe('a.txt');
        });

        it('should support pagination', async () => {
            await storage.save(createTextArtifact('1.txt', '1'));
            await storage.save(createTextArtifact('2.txt', '2'));
            await storage.save(createTextArtifact('3.txt', '3'));

            const page1 = await storage.list({ limit: 2, offset: 0 });
            const page2 = await storage.list({ limit: 2, offset: 2 });

            expect(page1).toHaveLength(2);
            expect(page2).toHaveLength(1);
        });
    });

    describe('search', () => {
        it('should search artifacts by name', async () => {
            await storage.save(createTextArtifact('report-2024.txt', 'content'));
            await storage.save(createTextArtifact('notes.txt', 'content'));

            const results = await storage.search('report');

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('report-2024.txt');
        });
    });
});

describe('Artifact Helpers', () => {
    describe('createTextArtifact', () => {
        it('should create a text artifact', () => {
            const artifact = createTextArtifact('file.txt', 'content');

            expect(artifact.name).toBe('file.txt');
            expect(artifact.type).toBe('file');
            expect(artifact.content).toBe('content');
            expect(artifact.mimeType).toBe('text/plain');
        });
    });

    describe('createMarkdownArtifact', () => {
        it('should create a markdown artifact', () => {
            const artifact = createMarkdownArtifact('doc.md', '# Title');

            expect(artifact.type).toBe('markdown');
            expect(artifact.mimeType).toBe('text/markdown');
        });
    });

    describe('createDataArtifact', () => {
        it('should create a JSON data artifact', () => {
            const data = { key: 'value', count: 42 };
            const artifact = createDataArtifact('data.json', data);

            expect(artifact.type).toBe('data');
            expect(artifact.content).toEqual(data);
            expect(artifact.mimeType).toBe('application/json');
        });
    });

    describe('createReasoningArtifact', () => {
        it('should create a reasoning artifact', () => {
            const artifact = createReasoningArtifact(
                'analysis',
                ['First thought', 'Second thought'],
                'Final conclusion',
                0.85
            );

            expect(artifact.type).toBe('reasoning');
            expect(artifact.content.thoughts).toHaveLength(2);
            expect(artifact.content.conclusion).toBe('Final conclusion');
            expect(artifact.content.confidence).toBe(0.85);
        });
    });

    describe('createPlanArtifact', () => {
        it('should create a plan artifact with steps', () => {
            const artifact = createPlanArtifact(
                'project-plan',
                'Build a feature',
                [
                    { description: 'Research requirements' },
                    { description: 'Implement solution' },
                    { description: 'Test and deploy' },
                ]
            );

            expect(artifact.type).toBe('plan');
            expect(artifact.content.goal).toBe('Build a feature');
            expect(artifact.content.steps).toHaveLength(3);
            expect(artifact.content.steps[0].status).toBe('pending');
            expect(artifact.content.status).toBe('draft');
        });
    });
});
