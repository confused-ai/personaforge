/**
 * SchedulerTools — give an agent the ability to create, list, update, and delete
 * its own schedules via chat.
 *
 * This mirrors Agno's `SchedulerTools` toolkit: an agent with these tools can
 * respond to "post a daily digest at 9am ET" by calling `create_schedule`.
 *
 * @example
 * ```ts
 * import { createAgent } from 'personaforge';
 * import { SchedulerTools } from 'personaforge/scheduler';
 * import { ScheduleManager } from 'personaforge/scheduler';
 *
 * const manager = new ScheduleManager();
 *
 * const agent = createAgent({
 *   name: 'SchedulerAgent',
 *   tools: [
 *     ...new SchedulerTools({
 *       manager,
 *       defaultEndpoint: '/agents/assistant/run',
 *       defaultTimezone: 'America/New_York',
 *     }).getTools(),
 *   ],
 * });
 * ```
 */

import type { ScheduleManager } from './manager.js';
import type { CreateScheduleInput } from './types.js';
import { validateCronExpr } from './cron.js';

export interface SchedulerToolsOptions {
    /** The ScheduleManager to operate on. */
    manager: ScheduleManager;
    /** Default HTTP endpoint to call when a schedule fires. */
    defaultEndpoint?: string;
    /** Default timezone for new schedules. Default: `'UTC'` */
    defaultTimezone?: string;
    /** Default HTTP method for schedule invocations. Default: `'POST'` */
    defaultMethod?: 'GET' | 'POST';
}

export interface SimpleTool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required?: string[];
    };
    execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * Returns an array of tools that a `createAgent` agent can use to manage schedules.
 */
export class SchedulerTools {
    private readonly manager: ScheduleManager;
    private readonly defaultEndpoint: string;
    private readonly defaultTimezone: string;
    private readonly defaultMethod: 'GET' | 'POST';

    constructor(options: SchedulerToolsOptions) {
        this.manager = options.manager;
        this.defaultEndpoint = options.defaultEndpoint ?? '/agents/assistant/run';
        this.defaultTimezone = options.defaultTimezone ?? 'UTC';
        this.defaultMethod = options.defaultMethod ?? 'POST';
    }

    getTools(): SimpleTool[] {
        return [
            this._createScheduleTool(),
            this._listSchedulesTool(),
            this._deleteScheduleTool(),
            this._enableScheduleTool(),
            this._disableScheduleTool(),
            this._triggerNowTool(),
        ];
    }

    private _createScheduleTool(): SimpleTool {
        return {
            name: 'create_schedule',
            description: 'Create a new recurring schedule. The cron expression follows standard 5-field format (min hour dom mon dow). E.g. "0 9 * * 1-5" for weekdays at 9am.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Human-readable name for the schedule' },
                    cron_expr: { type: 'string', description: 'Standard cron expression (5 fields)' },
                    endpoint: { type: 'string', description: 'HTTP endpoint to invoke (defaults to agent run endpoint)' },
                    timezone: { type: 'string', description: 'IANA timezone name, e.g. America/New_York (default: UTC)' },
                    payload: { type: 'string', description: 'Optional JSON string to send as request body' },
                },
                required: ['name', 'cron_expr'],
            },
            execute: async (args) => {
                const name = String(args['name'] ?? '');
                const cronExpr = String(args['cron_expr'] ?? '');
                if (!name) return 'Error: name is required';
                if (!cronExpr) return 'Error: cron_expr is required';
                try {
                    validateCronExpr(cronExpr);
                } catch (e) {
                    return `Error: invalid cron expression — ${e instanceof Error ? e.message : String(e)}`;
                }
                let payload: unknown;
                if (args['payload']) {
                    try { payload = JSON.parse(String(args['payload'])); } catch { payload = args['payload']; }
                }
                const input: CreateScheduleInput = {
                    name,
                    cronExpr,
                    endpoint: String(args['endpoint'] ?? this.defaultEndpoint),
                    method: this.defaultMethod,
                    timezone: String(args['timezone'] ?? this.defaultTimezone),
                    enabled: true,
                    ...(payload !== undefined && { payload }),
                };
                const id = await this.manager.create(input);
                return `Schedule created successfully. ID: ${id}. Will run at: ${cronExpr} (${input.timezone}).`;
            },
        };
    }

    private _listSchedulesTool(): SimpleTool {
        return {
            name: 'list_schedules',
            description: 'List all registered schedules, optionally filtered to enabled/disabled only.',
            parameters: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Filter schedules: "enabled", "disabled", or "all" (default)', enum: ['enabled', 'disabled', 'all'] },
                },
            },
            execute: async (args) => {
                const schedules = await this.manager.list();
                let filtered = schedules;
                if (args['filter'] === 'enabled') filtered = schedules.filter(s => s.enabled);
                if (args['filter'] === 'disabled') filtered = schedules.filter(s => !s.enabled);
                if (filtered.length === 0) return 'No schedules found.';
                return filtered.map(s =>
                    `• [${s.id}] ${s.name} — ${s.cronExpr} (${s.enabled ? 'enabled' : 'disabled'})${s.nextRunAt ? `, next: ${s.nextRunAt}` : ''}`
                ).join('\n');
            },
        };
    }

    private _deleteScheduleTool(): SimpleTool {
        return {
            name: 'delete_schedule',
            description: 'Permanently delete a schedule by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    schedule_id: { type: 'string', description: 'The schedule ID to delete' },
                },
                required: ['schedule_id'],
            },
            execute: async (args) => {
                const id = String(args['schedule_id'] ?? '');
                if (!id) return 'Error: schedule_id is required';
                const exists = await this.manager.get(id);
                if (!exists) return `Error: schedule '${id}' not found`;
                await this.manager.delete(id);
                return `Schedule '${id}' (${exists.name}) deleted successfully.`;
            },
        };
    }

    private _enableScheduleTool(): SimpleTool {
        return {
            name: 'enable_schedule',
            description: 'Enable a disabled schedule so it resumes running.',
            parameters: {
                type: 'object',
                properties: {
                    schedule_id: { type: 'string', description: 'The schedule ID to enable' },
                },
                required: ['schedule_id'],
            },
            execute: async (args) => {
                const id = String(args['schedule_id'] ?? '');
                if (!id) return 'Error: schedule_id is required';
                await this.manager.enable(id);
                return `Schedule '${id}' enabled.`;
            },
        };
    }

    private _disableScheduleTool(): SimpleTool {
        return {
            name: 'disable_schedule',
            description: 'Disable a schedule without deleting it.',
            parameters: {
                type: 'object',
                properties: {
                    schedule_id: { type: 'string', description: 'The schedule ID to disable' },
                },
                required: ['schedule_id'],
            },
            execute: async (args) => {
                const id = String(args['schedule_id'] ?? '');
                if (!id) return 'Error: schedule_id is required';
                await this.manager.disable(id);
                return `Schedule '${id}' disabled.`;
            },
        };
    }

    private _triggerNowTool(): SimpleTool {
        return {
            name: 'trigger_schedule_now',
            description: 'Immediately trigger a schedule outside of its normal cron cadence.',
            parameters: {
                type: 'object',
                properties: {
                    schedule_id: { type: 'string', description: 'The schedule ID to trigger' },
                },
                required: ['schedule_id'],
            },
            execute: async (args) => {
                const id = String(args['schedule_id'] ?? '');
                if (!id) return 'Error: schedule_id is required';
                const exists = await this.manager.get(id);
                if (!exists) return `Error: schedule '${id}' not found`;
                await this.manager.trigger(id);
                return `Schedule '${id}' (${exists.name}) triggered immediately.`;
            },
        };
    }
}
