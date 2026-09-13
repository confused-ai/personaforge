/**
 * HackerNews tool implementation - TypeScript  HackerNewsTools
 */

import { z } from 'zod';
import { BaseTool, BaseToolConfig } from '../core/base-tool.js';
import { ToolContext, ToolCategory } from '../core/types.js';

/**
 * HackerNews story
 */
interface HackerNewsStory {
    id: number;
    title?: string;
    url?: string;
    score?: number;
    by?: string;
    time?: number;
    descendants?: number;
    type: string;
    username?: string;
}

/**
 * HackerNews user details
 */
interface HackerNewsUser {
    id?: string;
    karma?: number;
    about?: string;
    total_items_submitted?: number;
}

interface HackerNewsResult {
    stories?: HackerNewsStory[];
    user?: HackerNewsUser;
    error?: string;
}

/**
 * Parameters for getting top stories
 */
const HackerNewsTopStoriesParameters = z.object({
    num_stories: z.number().min(1).max(50).optional().default(10).describe('Number of stories to return'),
});

/**
 * Parameters for getting user details
 */
const HackerNewsUserParameters = z.object({
    // HN usernames are alphanumerics, `-` and `_` — anything else would
    // interpolate into the request path.
    username: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe('Username of the Hacker News user'),
});

/**
 * HackerNews top stories tool
 */
export class HackerNewsTopStoriesTool extends BaseTool<typeof HackerNewsTopStoriesParameters, HackerNewsResult> {
    constructor(config?: Partial<Omit<BaseToolConfig<typeof HackerNewsTopStoriesParameters>, 'parameters'>>) {
        super({
            name: config?.name ?? 'hackernews_top_stories',
            description: config?.description ?? 'Get top stories from Hacker News',
            parameters: HackerNewsTopStoriesParameters,
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
        params: z.infer<typeof HackerNewsTopStoriesParameters>,
        _context: ToolContext
    ): Promise<HackerNewsResult> {
        try {
            // Fetch top story IDs
            const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');

            if (!response.ok) {
                throw new Error(`Failed to fetch top stories: ${response.status}`);
            }

            const storyIds = (await response.json()) as number[];
            const topIds = storyIds.slice(0, params.num_stories);

            // Fetch story details
            const stories: HackerNewsStory[] = [];
            for (const storyId of topIds) {
                if (!Number.isInteger(storyId)) continue;
                try {
                    const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`);
                    if (storyResponse.ok) {
                        const story = (await storyResponse.json()) as HackerNewsStory;
                        if (story.by !== undefined) story.username = story.by;
                        stories.push(story);
                    }
                } catch {
                    // Skip failed story fetches
                }
            }

            return { stories };
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
}

/**
 * HackerNews user details tool
 */
export class HackerNewsUserTool extends BaseTool<typeof HackerNewsUserParameters, HackerNewsResult> {
    constructor(config?: Partial<Omit<BaseToolConfig<typeof HackerNewsUserParameters>, 'parameters'>>) {
        super({
            name: config?.name ?? 'hackernews_user_details',
            description: config?.description ?? 'Get details of a Hacker News user',
            parameters: HackerNewsUserParameters,
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
        params: z.infer<typeof HackerNewsUserParameters>,
        _context: ToolContext
    ): Promise<HackerNewsResult> {
        try {
            const response = await fetch(`https://hacker-news.firebaseio.com/v0/user/${params.username}.json`);

            if (!response.ok) {
                throw new Error(`Failed to fetch user details: ${response.status}`);
            }

            const userData = (await response.json()) as {
                id?: string;
                karma?: number;
                about?: string;
                submitted?: number[];
            };

            if (!userData) {
                return {
                    error: `User ${params.username} not found`,
                };
            }

            const user: HackerNewsUser = { total_items_submitted: userData.submitted?.length || 0 };
            if (userData.id !== undefined) user.id = userData.id;
            if (userData.karma !== undefined) user.karma = userData.karma;
            if (userData.about !== undefined) user.about = userData.about;

            return { user };
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
}

/**
 * HackerNews toolkit
 */
export const HackerNewsToolkit = {
    create(options?: { enableTopStories?: boolean; enableUserDetails?: boolean }): Array<HackerNewsTopStoriesTool | HackerNewsUserTool> {
        const tools: Array<HackerNewsTopStoriesTool | HackerNewsUserTool> = [];

        if (options?.enableTopStories !== false) {
            tools.push(new HackerNewsTopStoriesTool());
        }
        if (options?.enableUserDetails !== false) {
            tools.push(new HackerNewsUserTool());
        }

        return tools;
    },
};
