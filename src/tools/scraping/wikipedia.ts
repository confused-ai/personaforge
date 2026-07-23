/**
 * Wikipedia tool implementation - TypeScript  WikipediaTools
 */

import { z } from 'zod';
import { BaseTool, BaseToolConfig } from '../core/base-tool.js';
import { ToolContext, ToolCategory } from '../core/types.js';

/**
 * Wikipedia API response types
 */
interface WikipediaSummaryResponse {
    title?: string;
    extract?: string;
    content_urls?: {
        desktop?: {
            page?: string;
        };
    };
}

interface WikipediaSearchResult {
    title: string;
    snippet: string;
}

interface WikipediaSearchResponse {
    query?: {
        search?: WikipediaSearchResult[];
    };
}

/**
 * Wikipedia search result
 */
interface WikipediaResult {
    title: string;
    content: string;
    url: string;
    error?: string;
}

/**
 * Parameters for Wikipedia search
 */
const WikipediaSearchParameters = z.object({
    query: z.string().describe('The topic or query to search for on Wikipedia'),
});

/**
 * Wikipedia search tool
 */
export class WikipediaSearchTool extends BaseTool<typeof WikipediaSearchParameters, WikipediaResult> {
    constructor(config?: Partial<Omit<BaseToolConfig<typeof WikipediaSearchParameters>, 'parameters'>>) {
        super({
            name: config?.name ?? 'wikipedia_search',
            description: config?.description ?? 'Search Wikipedia for a topic and get a summary',
            parameters: WikipediaSearchParameters,
            category: config?.category ?? ToolCategory.WEB,
            permissions: {
                allowNetwork: true,
                maxExecutionTimeMs: 30000,
                ...config?.permissions,
            },
            ...config,
        });
    }

    protected async performExecute(
        params: z.infer<typeof WikipediaSearchParameters>,
        _context: ToolContext
    ): Promise<WikipediaResult> {
        try {
            // Use Wikipedia's REST API
            const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(params.query.replace(/\s+/g, '_'))}`;

            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'personaforge/1.0',
                },
            });

            if (!response.ok) {
                // Try searching for the page first
                return await this.searchAndGetSummary(params.query);
            }

            const data = (await response.json()) as WikipediaSummaryResponse;

            return {
                title: data.title || params.query,
                content: data.extract || 'No summary available',
                url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(params.query.replace(/\s+/g, '_'))}`,
            };
        } catch (error) {
            return {
                title: params.query,
                content: '',
                url: '',
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    private async searchAndGetSummary(query: string): Promise<WikipediaResult> {
        try {
            // Search for the page
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;

            const searchResponse = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'personaforge/1.0',
                },
            });

            if (!searchResponse.ok) {
                throw new Error(`Wikipedia search failed: ${searchResponse.status}`);
            }

            const searchData = (await searchResponse.json()) as WikipediaSearchResponse;
            const searchResults = searchData.query?.search || [];

            if (searchResults.length === 0) {
                return {
                    title: query,
                    content: 'No results found on Wikipedia',
                    url: '',
                };
            }

            // Get the first result's title and fetch its summary
            const firstResult = searchResults[0];
            if (!firstResult) {
                return { title: query, content: 'No results found on Wikipedia', url: '' };
            }
            const pageTitle = firstResult.title;

            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`;

            const summaryResponse = await fetch(summaryUrl, {
                headers: {
                    'User-Agent': 'personaforge/1.0',
                },
            });

            if (!summaryResponse.ok) {
                // Return the search snippet if summary fails
                return {
                    title: pageTitle,
                    content: firstResult.snippet.replace(/<[^>]*>/g, ''),
                    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`,
                };
            }

            const summaryData = (await summaryResponse.json()) as WikipediaSummaryResponse;

            return {
                title: summaryData.title || pageTitle,
                content: summaryData.extract || firstResult.snippet.replace(/<[^>]*>/g, ''),
                url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`,
            };
        } catch (error) {
            return {
                title: query,
                content: '',
                url: '',
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
}

/**
 * Wikipedia toolkit
 */
export const WikipediaToolkit = {
    create(): Array<WikipediaSearchTool> {
        return [new WikipediaSearchTool()];
    },
};
