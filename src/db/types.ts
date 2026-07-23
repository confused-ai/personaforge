/**
 * @personaforge/db — shared types.
 *
 * Row shapes and query types for every table managed by AgentDb:
 *  - SessionRow    → agent_sessions
 *  - MemoryRow     → agent_memories
 *  - LearningRow   → agent_learnings  (unified, one row per learning, typed by learning_type)
 *  - KnowledgeRow  → agent_knowledge
 *  - TraceRow      → agent_traces
 *  - ScheduleRow   → agent_schedules
 *
 * To add a new backend: extend AgentDb and implement every abstract method.
 */

// ─── Learning types (Agno-compatible) ─────────────────────────────────────────

export type LearningType =
  | 'user_profile'
  | 'session_context'
  | 'user_memory'
  | 'entity_memory'
  | 'learned_knowledge'
  | 'decision_log'
  | (string & {}); // allow custom types

// ─── Row shapes (what the DB stores) ──────────────────────────────────────────

export interface SessionRow {
  session_id:   string;
  session_type: 'agent' | 'team' | 'workflow';
  agent_id?:    string | null;
  team_id?:     string | null;
  workflow_id?: string | null;
  user_id?:     string | null;
  agent_data?:  string | null;  // JSON blob
  team_data?:   string | null;  // JSON blob
  workflow_data?: string | null; // JSON blob
  session_data?: string | null; // JSON blob
  metadata?:    string | null;  // JSON blob
  runs?:        string | null;  // JSON blob
  summary?:     string | null;
  created_at:   number;
  updated_at:   number;
}

export interface MemoryRow {
  memory_id:   string;
  user_id?:    string | null;
  agent_id?:   string | null;
  team_id?:    string | null;
  memory:      string;
  topics?:     string | null;  // JSON array
  input?:      string | null;
  feedback?:   string | null;
  created_at:  number;
  updated_at:  number;
}

export interface LearningRow {
  learning_id:   string;
  learning_type: LearningType;
  namespace?:    string | null;
  user_id?:      string | null;
  agent_id?:     string | null;
  team_id?:      string | null;
  workflow_id?:  string | null;
  session_id?:   string | null;
  entity_id?:    string | null;
  entity_type?:  string | null;
  content:       string;       // JSON blob
  metadata?:     string | null; // JSON blob
  created_at:    number;
  updated_at:    number;
}

export interface KnowledgeRow {
  id:              string;
  name?:           string | null;
  description?:    string | null;
  content?:        string | null;  // JSON blob (embeddings, text, etc.)
  type?:           string | null;
  size?:           number | null;
  linked_to?:      string | null;  // knowledge instance name
  access_count?:   number;
  status?:         string | null;
  status_message?: string | null;
  external_id?:    string | null;
  metadata?:       string | null;  // JSON blob
  created_at?:     number | null;
  updated_at?:     number | null;
}

export interface TraceRow {
  trace_id:    string;
  run_id?:     string | null;
  session_id?: string | null;
  user_id?:    string | null;
  agent_id?:   string | null;
  team_id?:    string | null;
  workflow_id?: string | null;
  name?:       string | null;
  status?:     string | null;
  start_time?: string | null;  // ISO
  end_time?:   string | null;  // ISO
  duration_ms?: number | null;
  metadata?:   string | null;  // JSON
  created_at:  number;
  updated_at:  number;
}

export interface ScheduleRow {
  id:           string;
  name:         string;
  agent_id?:    string | null;
  cron?:        string | null;
  enabled:      boolean;
  next_run_at?: number | null;
  last_run_at?: number | null;
  locked_by?:   string | null;
  locked_at?:   number | null;
  metadata?:    string | null;  // JSON
  created_at:   number;
  updated_at:   number;
}

// ─── Query / filter options ────────────────────────────────────────────────────

export interface SessionQuery {
  sessionId?:  string;
  sessionType?: 'agent' | 'team' | 'workflow';
  agentId?:    string;
  teamId?:     string;
  workflowId?: string;
  userId?:     string;
  limit?:      number;
  offset?:     number;
}

export interface MemoryQuery {
  userId?:    string;
  agentId?:   string;
  teamId?:    string;
  topics?:    string[];
  search?:    string;
  limit?:     number;
  offset?:    number;
}

export interface LearningQuery {
  learningType?: LearningType;
  userId?:      string;
  agentId?:     string;
  teamId?:      string;
  workflowId?:  string;
  sessionId?:   string;
  namespace?:   string;
  entityId?:    string;
  entityType?:  string;
  limit?:       number;
}

export interface KnowledgeQuery {
  linkedTo?: string;
  status?:   string;
  limit?:    number;
  offset?:   number;
}

// ─── Upsert inputs (the "domain" shape callers pass in) ──────────────────────

export interface UpsertSessionInput {
  sessionId:    string;
  sessionType?: 'agent' | 'team' | 'workflow';
  agentId?:     string;
  teamId?:      string;
  workflowId?:  string;
  userId?:      string;
  agentData?:   Record<string, unknown>;
  teamData?:    Record<string, unknown>;
  workflowData?: Record<string, unknown>;
  sessionData?: Record<string, unknown>;
  metadata?:    Record<string, unknown>;
  runs?:        unknown[];
  summary?:     string;
}

export interface UpsertMemoryInput {
  memoryId?:  string;
  userId?:    string;
  agentId?:   string;
  teamId?:    string;
  memory:     string;
  topics?:    string[];
  input?:     string;
  feedback?:  string;
}

export interface UpsertLearningInput {
  id:           string;
  learningType: LearningType;
  content:      Record<string, unknown>;
  userId?:      string;
  agentId?:     string;
  teamId?:      string;
  workflowId?:  string;
  sessionId?:   string;
  namespace?:   string;
  entityId?:    string;
  entityType?:  string;
  metadata?:    Record<string, unknown>;
}

export interface UpsertKnowledgeInput {
  id:            string;
  name?:         string;
  description?:  string;
  content?:      Record<string, unknown> | string;
  type?:         string;
  size?:         number;
  linkedTo?:     string;
  status?:       string;
  statusMessage?: string;
  externalId?:   string;
  metadata?:     Record<string, unknown>;
}

// ─── Table names config ────────────────────────────────────────────────────────

export interface AgentDbTableNames {
  sessions?:   string;
  memories?:   string;
  learnings?:  string;
  knowledge?:  string;
  traces?:     string;
  schedules?:  string;
}

export const DEFAULT_TABLE_NAMES: Required<AgentDbTableNames> = {
  sessions:  'agent_sessions',
  memories:  'agent_memories',
  learnings: 'agent_learnings',
  knowledge: 'agent_knowledge',
  traces:    'agent_traces',
  schedules: 'agent_schedules',
};
