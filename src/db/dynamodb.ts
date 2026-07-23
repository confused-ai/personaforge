/**
 * @personaforge/db/dynamodb — DynamoDbAgentDb.
 *
 * Uses AWS SDK v3 `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`.
 * All 6 tables are stored in a single DynamoDB table using a composite
 * primary key (pk = table#id, sk = "ROW"). This single-table design
 * minimises provisioned capacity and simplifies deployment.
 *
 * Peer dep: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (optional).
 */

import { AgentDb, validateTableNames } from './base.js';
import { DEFAULT_TABLE_NAMES } from './types.js';
import { uuid, now } from './utils.js';
import type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames,
} from './types.js';

const MISSING =
  '[personaforge/db] DynamoDbAgentDb requires @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb.\n' +
  '  Install: npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb';

// Minimal surface types (avoid hard dep on AWS SDK)

type DDBDocClient = { send(cmd: any): Promise<any> };

type DDBClient = any;



export interface DynamoDbAgentDbOptions {
  /** DynamoDB table name. Defaults to `AgentDb`. */
  tableName?: string;
  /** AWS region. Defaults to `us-east-1`. */
  region?: string;
  /** Optional endpoint for local DynamoDB (e.g. `http://localhost:8000`). */
  endpoint?: string;
  /** Logical prefixes for each entity type (no effect on DDB table name). */
  tables?: AgentDbTableNames;
}

export class DynamoDbAgentDb extends AgentDb {
  readonly type = 'dynamodb';

  private readonly tableName: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;
  private readonly t: Required<AgentDbTableNames>;
  private _client: DDBClient | null = null;
  private _doc: DDBDocClient | null = null;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  constructor(opts: DynamoDbAgentDbOptions = {}) {
    super();
    this.tableName = opts.tableName ?? 'AgentDb';
    this.region = opts.region ?? 'us-east-1';
    this.endpoint = opts.endpoint;
    this.t = validateTableNames({ ...DEFAULT_TABLE_NAMES, ...(opts.tables ?? {}) });
  }

  private doc(): DDBDocClient {
    if (this._doc) return this._doc;

    let ddbLib: any, docLib: any;
    try {
      ddbLib = require('@aws-sdk/client-dynamodb');
      docLib = require('@aws-sdk/lib-dynamodb');
    } catch { throw new Error(MISSING); }
    const clientOpts: Record<string, unknown> = { region: this.region };
    if (this.endpoint) clientOpts['endpoint'] = this.endpoint;
    this._client = new ddbLib.DynamoDBClient(clientOpts);
    this._doc = docLib.DynamoDBDocumentClient.from(this._client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    return this._doc!;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (!this._initPromise) this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {

    let ddbLib: any;
    try { ddbLib = require('@aws-sdk/client-dynamodb'); } catch { throw new Error(MISSING); }
    // Try to create the table; ignore ResourceInUseException (already exists)
    try {
      const client = this.doc();
      await (client as DDBDocClient).send(new ddbLib.CreateTableCommand({
        TableName: this.tableName,
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'gsi1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            BillingMode: 'PAY_PER_REQUEST',
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== 'ResourceInUseException') throw err;
    }
    this._ready = true;
  }

  async close(): Promise<void> {
    if (this._client && typeof this._client.destroy === 'function') {
      this._client.destroy();
    }
    this._client = null;
    this._doc = null;
    this._ready = false;
    this._initPromise = null;
  }

  // ── Key helpers ────────────────────────────────────────────────────────────

  private pk(entity: string, id: string): string { return `${entity}#${id}`; }
  private gsiPk(entity: string, filterKey: string, filterValue: string): string {
    return `${entity}#${filterKey}#${filterValue}`;
  }


  private async _put(entity: string, id: string, data: Record<string, unknown>, gsi?: { key: string; value: string }): Promise<void> {

    let docLib: any;
    try { docLib = require('@aws-sdk/lib-dynamodb'); } catch { throw new Error(MISSING); }
    const item: Record<string, unknown> = {
      pk: this.pk(entity, id),
      sk: 'ROW',
      _entity: entity,
      ...data,
    };
    if (gsi) {
      item['gsi1pk'] = this.gsiPk(entity, gsi.key, gsi.value);
      item['gsi1sk'] = String(data['updated_at'] ?? now());
    }
    await this.doc().send(new docLib.PutCommand({
      TableName: this.tableName,
      Item: item,
    }));
  }

  private async _get(entity: string, id: string): Promise<Record<string, unknown> | null> {

    let docLib: any;
    try { docLib = require('@aws-sdk/lib-dynamodb'); } catch { throw new Error(MISSING); }
    const result = await this.doc().send(new docLib.GetCommand({
      TableName: this.tableName,
      Key: { pk: this.pk(entity, id), sk: 'ROW' },
    }));
    return result.Item ?? null;
  }

  private async _del(entity: string, id: string): Promise<boolean> {

    let docLib: any;
    try { docLib = require('@aws-sdk/lib-dynamodb'); } catch { throw new Error(MISSING); }
    const existing = await this._get(entity, id);
    if (!existing) return false;
    await this.doc().send(new docLib.DeleteCommand({
      TableName: this.tableName,
      Key: { pk: this.pk(entity, id), sk: 'ROW' },
    }));
    return true;
  }

  private async _scan(entity: string, limit?: number): Promise<Record<string, unknown>[]> {

    let docLib: any;
    try { docLib = require('@aws-sdk/lib-dynamodb'); } catch { throw new Error(MISSING); }
    const result = await this.doc().send(new docLib.ScanCommand({
      TableName: this.tableName,
      FilterExpression: '#e = :entity',
      ExpressionAttributeNames: { '#e': '_entity' },
      ExpressionAttributeValues: { ':entity': entity },
      ...(limit ? { Limit: limit * 3 } : {}), // overscan since filter is post-scan
    }));
    return (result.Items ?? []) as Record<string, unknown>[];
  }

  // ── Cleanup helper — strip DDB keys from row ──────────────────────────────

  private _clean<T>(item: Record<string, unknown>): T {
    const { pk: _pk, sk: _sk, _entity: _e, gsi1pk: _g1, gsi1sk: _g2, ...rest } = item;
    return rest as T;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async upsertSession(input: UpsertSessionInput): Promise<SessionRow> {
    await this.init();
    const ts = now();
    const existing = await this._get(this.t.sessions, input.sessionId);
    const row: SessionRow = {
      session_id:    input.sessionId,
      session_type:  input.sessionType  ?? 'agent',
      agent_id:      input.agentId      ?? null,
      team_id:       input.teamId       ?? null,
      workflow_id:   input.workflowId   ?? null,
      user_id:       input.userId       ?? null,
      agent_data:    input.agentData    ? JSON.stringify(input.agentData)    : null,
      team_data:     input.teamData     ? JSON.stringify(input.teamData)     : null,
      workflow_data: input.workflowData ? JSON.stringify(input.workflowData) : null,
      session_data:  input.sessionData  ? JSON.stringify(input.sessionData)  : null,
      metadata:      input.metadata     ? JSON.stringify(input.metadata)     : null,
      runs:          input.runs         ? JSON.stringify(input.runs)         : null,
      summary:       input.summary ?? null,
      created_at:    (existing?.['created_at'] as number) ?? ts,
      updated_at:    ts,
    };
    const gsi = input.userId ? { key: 'user_id', value: input.userId } : undefined;
    await this._put(this.t.sessions, input.sessionId, row as unknown as Record<string, unknown>, gsi);
    return row;
  }

  async getSession(sessionId: string, userId?: string): Promise<SessionRow | null> {
    await this.init();
    const item = await this._get(this.t.sessions, sessionId);
    if (!item) return null;
    const row = this._clean<SessionRow>(item);
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getSessions(query: SessionQuery): Promise<SessionRow[]> {
    await this.init();
    let rows = (await this._scan(this.t.sessions, query.limit)).map(i => this._clean<SessionRow>(i));
    if (query.sessionType) rows = rows.filter(r => r.session_type === query.sessionType);
    if (query.agentId)     rows = rows.filter(r => r.agent_id     === query.agentId);
    if (query.teamId)      rows = rows.filter(r => r.team_id      === query.teamId);
    if (query.workflowId)  rows = rows.filter(r => r.workflow_id  === query.workflowId);
    if (query.userId)      rows = rows.filter(r => r.user_id      === query.userId);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async deleteSession(sessionId: string, userId?: string): Promise<boolean> {
    if (userId !== undefined) {
      const row = await this.getSession(sessionId, userId);
      if (!row) return false;
    }
    return this._del(this.t.sessions, sessionId);
  }

  async renameSession(sessionId: string, name: string, userId?: string): Promise<SessionRow | null> {
    const row = await this.getSession(sessionId, userId);
    if (!row) return null;
    const sd = row.session_data ? JSON.parse(row.session_data) as Record<string, unknown> : {};
    sd['session_name'] = name;
    const updated = { ...row, session_data: JSON.stringify(sd), updated_at: now() };
    await this._put(this.t.sessions, sessionId, updated as unknown as Record<string, unknown>);
    return updated;
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  async upsertMemory(input: UpsertMemoryInput): Promise<MemoryRow> {
    await this.init();
    const ts = now();
    const memoryId = input.memoryId ?? uuid();
    const existing = await this._get(this.t.memories, memoryId);
    const row: MemoryRow = {
      memory_id:  memoryId,
      user_id:    input.userId   ?? null,
      agent_id:   input.agentId  ?? null,
      team_id:    input.teamId   ?? null,
      memory:     input.memory,
      topics:     input.topics   ? JSON.stringify(input.topics) : null,
      input:      input.input    ?? null,
      feedback:   input.feedback ?? null,
      created_at: (existing?.['created_at'] as number) ?? ts,
      updated_at: ts,
    };
    const gsi = input.userId ? { key: 'user_id', value: input.userId } : undefined;
    await this._put(this.t.memories, memoryId, row as unknown as Record<string, unknown>, gsi);
    return row;
  }

  async getMemory(memoryId: string, userId?: string): Promise<MemoryRow | null> {
    await this.init();
    const item = await this._get(this.t.memories, memoryId);
    if (!item) return null;
    const row = this._clean<MemoryRow>(item);
    if (userId !== undefined && row.user_id !== userId) return null;
    return row;
  }

  async getMemories(query: MemoryQuery): Promise<MemoryRow[]> {
    await this.init();
    let rows = (await this._scan(this.t.memories, query.limit)).map(i => this._clean<MemoryRow>(i));
    if (query.userId)  rows = rows.filter(r => r.user_id  === query.userId);
    if (query.agentId) rows = rows.filter(r => r.agent_id === query.agentId);
    if (query.teamId)  rows = rows.filter(r => r.team_id  === query.teamId);
    if (query.search)  rows = rows.filter(r => r.memory.toLowerCase().includes(query.search!.toLowerCase()));
    rows.sort((a, b) => b.updated_at - a.updated_at);
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async deleteMemory(memoryId: string, userId?: string): Promise<boolean> {
    if (userId !== undefined) {
      const row = await this.getMemory(memoryId, userId);
      if (!row) return false;
    }
    return this._del(this.t.memories, memoryId);
  }

  async clearMemories(userId?: string): Promise<void> {
    await this.init();
    if (userId === undefined) {
      const items = await this._scan(this.t.memories);
      await Promise.all(items.map(i => this._del(this.t.memories, (i as Record<string, unknown>)['memory_id'] as string)));
    } else {
      const rows = await this.getMemories({ userId });
      await Promise.all(rows.map(r => this._del(this.t.memories, r.memory_id)));
    }
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async upsertLearning(input: UpsertLearningInput): Promise<void> {
    await this.init();
    const ts = now();
    const existing = await this._get(this.t.learnings, input.id);
    const row: LearningRow = {
      learning_id: input.id, learning_type: input.learningType,
      namespace: input.namespace ?? null, user_id: input.userId ?? null,
      agent_id: input.agentId ?? null, team_id: input.teamId ?? null,
      workflow_id: input.workflowId ?? null, session_id: input.sessionId ?? null,
      entity_id: input.entityId ?? null, entity_type: input.entityType ?? null,
      content: JSON.stringify(input.content),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: (existing?.['created_at'] as number) ?? ts, updated_at: ts,
    };
    await this._put(this.t.learnings, input.id, row as unknown as Record<string, unknown>);
  }

  async getLearning(query: LearningQuery): Promise<LearningRow | null> {
    const rows = await this.getLearnings({ ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async getLearnings(query: LearningQuery): Promise<LearningRow[]> {
    await this.init();
    let rows = (await this._scan(this.t.learnings, query.limit)).map(i => this._clean<LearningRow>(i));
    if (query.learningType) rows = rows.filter(r => r.learning_type === query.learningType);
    if (query.userId)       rows = rows.filter(r => r.user_id       === query.userId);
    if (query.agentId)      rows = rows.filter(r => r.agent_id      === query.agentId);
    if (query.teamId)       rows = rows.filter(r => r.team_id       === query.teamId);
    if (query.workflowId)   rows = rows.filter(r => r.workflow_id   === query.workflowId);
    if (query.sessionId)    rows = rows.filter(r => r.session_id    === query.sessionId);
    if (query.namespace)    rows = rows.filter(r => r.namespace      === query.namespace);
    if (query.entityId)     rows = rows.filter(r => r.entity_id     === query.entityId);
    if (query.entityType)   rows = rows.filter(r => r.entity_type   === query.entityType);
    rows.sort((a, b) => b.updated_at - a.updated_at);
    if (query.limit !== undefined) rows = rows.slice(0, query.limit);
    return rows;
  }

  async deleteLearning(id: string): Promise<boolean> {
    return this._del(this.t.learnings, id);
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async upsertKnowledge(input: UpsertKnowledgeInput): Promise<KnowledgeRow> {
    await this.init();
    const ts = now();
    const existing = await this._get(this.t.knowledge, input.id);
    const row: KnowledgeRow = {
      id: input.id, name: input.name ?? null, description: input.description ?? null,
      content: input.content ? (typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) : null,
      type: input.type ?? null, size: input.size ?? null, linked_to: input.linkedTo ?? null,
      access_count: (existing?.['access_count'] as number) ?? 0,
      status: input.status ?? null, status_message: input.statusMessage ?? null,
      external_id: input.externalId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: (existing?.['created_at'] as number) ?? ts, updated_at: ts,
    };
    await this._put(this.t.knowledge, input.id, row as unknown as Record<string, unknown>);
    return row;
  }

  async getKnowledge(id: string): Promise<KnowledgeRow | null> {
    await this.init();
    const item = await this._get(this.t.knowledge, id);
    return item ? this._clean<KnowledgeRow>(item) : null;
  }

  async getKnowledgeItems(query: KnowledgeQuery): Promise<[KnowledgeRow[], number]> {
    await this.init();
    let rows = (await this._scan(this.t.knowledge, query.limit)).map(i => this._clean<KnowledgeRow>(i));
    if (query.linkedTo) rows = rows.filter(r => r.linked_to === query.linkedTo);
    if (query.status)   rows = rows.filter(r => r.status    === query.status);
    const total  = rows.length;
    const offset = query.offset ?? 0;
    return [rows.slice(offset, offset + (query.limit ?? rows.length)), total];
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    return this._del(this.t.knowledge, id);
  }

  // ── Traces ─────────────────────────────────────────────────────────────────

  async upsertTrace(trace: Omit<TraceRow, 'created_at' | 'updated_at'> & { created_at?: number; updated_at?: number }): Promise<void> {
    try {
      await this.init();
      const ts = now();
      const existing = await this._get(this.t.traces, trace.trace_id);
      await this._put(this.t.traces, trace.trace_id, {
        ...trace,
        created_at: (existing?.['created_at'] as number) ?? trace.created_at ?? ts,
        updated_at: ts,
      });
    } catch { /* traces must not break agent flow */ }
  }

  async getTrace(traceId: string): Promise<TraceRow | null> {
    await this.init();
    const item = await this._get(this.t.traces, traceId);
    return item ? this._clean<TraceRow>(item) : null;
  }

  async getTraces(opts: { sessionId?: string; agentId?: string; userId?: string; limit?: number; offset?: number }): Promise<[TraceRow[], number]> {
    await this.init();
    let rows = (await this._scan(this.t.traces, opts.limit)).map(i => this._clean<TraceRow>(i));
    if (opts.sessionId) rows = rows.filter(r => r.session_id === opts.sessionId);
    if (opts.agentId)   rows = rows.filter(r => r.agent_id   === opts.agentId);
    if (opts.userId)    rows = rows.filter(r => r.user_id    === opts.userId);
    rows.sort((a, b) => b.created_at - a.created_at);
    const total  = rows.length;
    const offset = opts.offset ?? 0;
    return [rows.slice(offset, offset + (opts.limit ?? rows.length)), total];
  }

  // ── Schedules ──────────────────────────────────────────────────────────────

  async createSchedule(row: Omit<ScheduleRow, 'created_at' | 'updated_at'>): Promise<ScheduleRow> {
    await this.init();
    const ts = now();
    const full: ScheduleRow = { ...row, created_at: ts, updated_at: ts };
    await this._put(this.t.schedules, row.id, full as unknown as Record<string, unknown>);
    return full;
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    await this.init();
    const item = await this._get(this.t.schedules, id);
    return item ? this._clean<ScheduleRow>(item) : null;
  }

  async getSchedules(opts?: { enabled?: boolean; limit?: number }): Promise<ScheduleRow[]> {
    await this.init();
    let rows = (await this._scan(this.t.schedules, opts?.limit)).map(i => this._clean<ScheduleRow>(i));
    if (opts?.enabled !== undefined) rows = rows.filter(r => r.enabled === opts.enabled);
    if (opts?.limit !== undefined)   rows = rows.slice(0, opts.limit);
    return rows;
  }

  async updateSchedule(id: string, updates: Partial<ScheduleRow>): Promise<ScheduleRow | null> {
    const row = await this.getSchedule(id);
    if (!row) return null;
    const updated = { ...row, ...updates, updated_at: now() };
    await this._put(this.t.schedules, id, updated as unknown as Record<string, unknown>);
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this._del(this.t.schedules, id);
  }

  override toDict(): Record<string, unknown> {
    return { type: this.type, tableName: this.tableName, region: this.region };
  }
}
