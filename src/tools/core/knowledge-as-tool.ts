/**
 * `knowledgeAsTool()` — expose a RAG / knowledge base to an agent as a callable
 * tool, so the agent can query or add to the knowledge base through the
 * standard tool-calling interface.
 *
 * Works against any {@link RAGEngine}-shaped target: the built-in
 * `KnowledgeEngine`, DB-backed stores, adapter-backed engines, and custom
 * retrievers.
 *
 * @example
 * ```ts
 * import { agent, knowledgeAsTool } from 'personaforge';
 * import { createKnowledgeEngine } from 'personaforge/knowledge';
 * import { z } from 'zod';
 *
 * const kb = createKnowledgeEngine({ /* embedding provider *\/ });
 * await kb.addDocuments([{ id: '1', content: 'personaforge supports durable workflows.', metadata: {} }]);
 *
 * const kbTool = knowledgeAsTool({
 *   name: 'docs_search',
 *   description: 'Search the product documentation knowledge base.',
 *   knowledge: kb,
 *   parameters: z.object({ query: z.string() }),
 * });
 *
 * const supportAgent = agent({
 *   instructions: 'Answer only from the knowledge base.',
 *   tools: [kbTool],
 * });
 * ```
 */

import { z } from 'zod';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool } from './tool-helper.js';
import { tool } from './tool-helper.js';
import type { RAGEngine, RAGChunk } from '../../knowledge/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural contract for a knowledge base. Any object exposing these
 * methods can be wrapped — most `RAGEngine` implementations qualify.
 */
export interface KnowledgeBaseLike {
    buildContext?(query: string, topK?: number): Promise<string>;
    retrieve?(query: string, options?: { limit?: number; threshold?: number; filter?: Record<string, unknown> }): Promise<{
        chunks: RAGChunk[];
        query: string;
    }>;
    addDocuments?(docs: Array<{ id?: string; content: string; metadata?: Record<string, unknown> }>): Promise<void>;
    ingest?(chunks: Array<{ content: string; metadata?: Record<string, unknown> }>): Promise<void>;
}

const DEFAULT_KNOWLEDGE_PARAMETERS = z.object({
    action: z.enum(['search', 'add']).optional().describe('search the knowledge base or add documents'),
    query: z.string().optional().describe('Search query (required for action=search)'),
    limit: z.number().int().positive().max(50).optional().describe('Max chunks to retrieve'),
    documents: z.array(
        z.object({
            content: z.string().describe('Document text'),
            metadata: z.record(z.string(), z.unknown()).optional(),
        }),
    ).optional().describe('Documents to add (required for action=add)'),
}) as ToolObjectSchemaLike<Record<string, unknown>>;

/**
 * Configuration for `knowledgeAsTool()`.
 */
export interface KnowledgeAsToolOptions {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** The knowledge base / RAG engine to wrap. */
    readonly knowledge: KnowledgeBaseLike;
    /** Zod schema for tool parameters. Defaults to the standard action schema. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 30_000. */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the knowledge tool runs. Return false to cancel. */
    readonly beforeExecute?: (params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the knowledge tool completes. */
    readonly afterExecute?: (output: unknown, params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during knowledge access. */
    readonly onError?: (error: Error, params: Record<string, unknown>, ctx: SimpleToolContext) => unknown | Promise<unknown>;
    /** Whether the tool may write (add documents). Default: true. */
    readonly writeable?: boolean;
}

function extractChunks(results: {
    chunks: RAGChunk[];
    query: string;
}): Array<{ id: string; content: string; score?: number; metadata?: Record<string, unknown>; source?: string }> {
    return results.chunks.map((c) => ({
        id: c.id,
        content: c.content,
        ...(typeof c.score === 'number' ? { score: c.score } : {}),
        ...(c.metadata !== undefined ? { metadata: c.metadata } : {}),
        ...(c.source !== undefined ? { source: c.source } : {}),
    }));
}

/**
 * Wrap a knowledge base / RAG engine as a tool so agents can query or extend
 * it via function calling.
 */
export function knowledgeAsTool(
    config: KnowledgeAsToolOptions,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, unknown> {
    const {
        name,
        description,
        knowledge,
        parameters = DEFAULT_KNOWLEDGE_PARAMETERS,
        category = ToolCategory.AI,
        tags = ['knowledge-tool', 'rag-tool'],
        timeoutMs = 30_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
        writeable = true,
    } = config;

    const execute = async (params: Record<string, unknown>): Promise<unknown> => {
        const action = typeof params.action === 'string' ? params.action : 'search';

        if (action === 'add') {
            if (!writeable) {
                throw new Error(`Knowledge tool "${name}" is read-only; action "add" is not permitted.`);
            }
            const documents = Array.isArray(params.documents) ? params.documents : [];
            if (documents.length === 0) {
                throw new Error(`Knowledge tool "${name}": action=add requires a non-empty "documents" array.`);
            }
            const addable = documents.map((d) => ({
                content: String((d as { content?: unknown }).content ?? '').trim(),
                ...((d as { metadata?: Record<string, unknown> }).metadata !== undefined
                    ? { metadata: (d as { metadata?: Record<string, unknown> }).metadata }
                    : {}),
            }));
            if (knowledge.ingest) {
                await knowledge.ingest(addable);
            } else if (knowledge.addDocuments) {
                await knowledge.addDocuments(addable.map((d, i) => ({ id: `doc-${i}-${Date.now()}`, ...d })));
            } else {
                throw new Error(`Knowledge tool "${name}": this knowledge base does not support adding documents.`);
            }
            return { action: 'added', count: addable.length };
        }

        if (action !== 'search') {
            throw new Error(
                `Knowledge tool "${name}": unknown action "${action}". Expected one of: search, add.`,
            );
        }

        const query = typeof params.query === 'string' && params.query.trim()
            ? params.query
            : '';
        if (!query) {
            throw new Error(`Knowledge tool "${name}": action=search requires a non-empty "query".`);
        }

        const limit = typeof params.limit === 'number' ? params.limit : undefined;

        if (knowledge.retrieve) {
            const result = await knowledge.retrieve(query, {
                ...(limit !== undefined ? { limit } : {}),
            });
            const chunks = extractChunks(result);
            return {
                action: 'search',
                query,
                count: chunks.length,
                results: chunks,
            };
        }

        if (knowledge.buildContext) {
            const context = await knowledge.buildContext(query, limit);
            return { action: 'search', query, context };
        }

        throw new Error(
            `Knowledge tool "${name}": this knowledge base exposes neither retrieve() nor buildContext().`,
        );
    };

    return tool({
        name,
        description,
        parameters,
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined ? { beforeExecute } : {}),
        ...(afterExecute !== undefined ? { afterExecute } : {}),
        ...(onError !== undefined ? { onError } : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, unknown>);
}
