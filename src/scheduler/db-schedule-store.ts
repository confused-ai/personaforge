/**
 * @personaforge/scheduler — DbScheduleStore
 *
 * Implements `ScheduleStore` on top of any `AgentDb` backend.
 * Bridges the ScheduleManager's scheduling API with the unified
 * `agent_schedules` table managed by @personaforge/db.
 *
 * Mapping between domain types:
 *   Schedule.id          ↔  ScheduleRow.id
 *   Schedule.name        ↔  ScheduleRow.name
 *   Schedule.cronExpr    ↔  ScheduleRow.cron
 *   Schedule.endpoint    ↔  metadata.endpoint
 *   Schedule.method      ↔  metadata.method
 *   Schedule.payload     ↔  metadata.payload
 *   Schedule.timezone    ↔  metadata.timezone
 *   Schedule.enabled     ↔  ScheduleRow.enabled
 *   Schedule.nextRunAt   ↔  ScheduleRow.next_run_at (epoch s → ISO)
 *   Schedule.maxRetries  ↔  metadata.maxRetries
 *   Schedule.retryDelaySeconds ↔ metadata.retryDelaySeconds
 *   Schedule.createdAt   ↔  ScheduleRow.created_at (epoch s → ISO)
 *   Schedule.updatedAt   ↔  ScheduleRow.updated_at (epoch s → ISO)
 *
 * Usage:
 * ```ts
 * import { SqliteAgentDb } from '../db/index.js';
 * import { ScheduleManager, DbScheduleStore } from './index.js';
 *
 * const db    = new SqliteAgentDb({ path: './agent.db' });
 * const store = new DbScheduleStore(db);
 * const mgr   = new ScheduleManager({ store });
 * ```
 */

import type { AgentDb, ScheduleRow } from '../db/index.js';
import type { Schedule } from './types.js';
import type { ScheduleStore } from './manager.js';

function epochToIso(epochSeconds: number | null | undefined): string {
    if (epochSeconds == null) return new Date(0).toISOString();
    return new Date(epochSeconds * 1000).toISOString();
}

function isoToEpoch(iso: string | undefined): number | null {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Convert a DB ScheduleRow to the domain Schedule type. */
function rowToSchedule(row: ScheduleRow): Schedule {
    const meta = row.metadata
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : {};
    return {
        id:                 row.id,
        name:               row.name,
        cronExpr:           row.cron ?? '',
        endpoint:           (meta['endpoint'] as string | undefined) ?? '',
        method:             (meta['method'] as Schedule['method'] | undefined),
        payload:            meta['payload'],
        timezone:           meta['timezone'] as string | undefined,
        enabled:            row.enabled,
        nextRunAt:          row.next_run_at != null ? epochToIso(row.next_run_at) : undefined,
        maxRetries:         meta['maxRetries'] as number | undefined,
        retryDelaySeconds:  meta['retryDelaySeconds'] as number | undefined,
        createdAt:          epochToIso(row.created_at),
        updatedAt:          epochToIso(row.updated_at),
    };
}

/** Convert a domain Schedule to a partial ScheduleRow for persistence. */
function scheduleToRowInput(schedule: Schedule): Omit<ScheduleRow, 'created_at' | 'updated_at'> {
    const meta: Record<string, unknown> = { endpoint: schedule.endpoint };
    if (schedule.method !== undefined)           meta['method']             = schedule.method;
    if (schedule.payload !== undefined)          meta['payload']            = schedule.payload;
    if (schedule.timezone !== undefined)         meta['timezone']           = schedule.timezone;
    if (schedule.maxRetries !== undefined)       meta['maxRetries']         = schedule.maxRetries;
    if (schedule.retryDelaySeconds !== undefined) meta['retryDelaySeconds'] = schedule.retryDelaySeconds;

    return {
        id:          schedule.id,
        name:        schedule.name,
        cron:        schedule.cronExpr || null,
        enabled:     schedule.enabled,
        next_run_at: isoToEpoch(schedule.nextRunAt),
        last_run_at: null,
        locked_by:   null,
        locked_at:   null,
        metadata:    JSON.stringify(meta),
    };
}

export class DbScheduleStore implements ScheduleStore {
    constructor(private readonly db: AgentDb) {}

    async get(id: string): Promise<Schedule | null> {
        await this.db.init();
        const row = await this.db.getSchedule(id);
        return row ? rowToSchedule(row) : null;
    }

    async list(enabledOnly = false): Promise<Schedule[]> {
        await this.db.init();
        const rows = await this.db.getSchedules(
            enabledOnly ? { enabled: true } : undefined,
        );
        return rows.map(rowToSchedule);
    }

    async save(schedule: Schedule): Promise<Schedule> {
        await this.db.init();
        const existing = await this.db.getSchedule(schedule.id);
        if (existing) {
            const updated = await this.db.updateSchedule(schedule.id, {
                ...scheduleToRowInput(schedule),
            });
            return updated ? rowToSchedule(updated) : schedule;
        }
        const created = await this.db.createSchedule(scheduleToRowInput(schedule));
        return rowToSchedule(created);
    }

    async delete(id: string): Promise<boolean> {
        await this.db.init();
        return this.db.deleteSchedule(id);
    }
}
