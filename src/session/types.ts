/**
 * @personaforge/session — session store types.
 * Consumed by @personaforge/core via the SessionStore interface.
 */

export interface SessionData {
  readonly id: string;
  readonly agentId: string;
  readonly userId?: string;
  readonly messages: ReadonlyArray<SessionMessage>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly tool_call_id?: string;
}

/**
 * SessionStore — minimal interface (ISP).
 * Four methods covering the full lifecycle — no more.
 */
export interface SessionStore {
  get(id: string): Promise<SessionData | undefined>;
  /**
   * Create a new session.
   * - Pass an object `{ agentId, userId?, messages? }` to auto-generate an ID.
   * - Pass a plain string to create a session with that specific ID (useful in tests
   *   and resumable-conversation flows where you own the ID).
   */
  create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData>;
  update(id: string, data: { messages: SessionMessage[] }): Promise<void>;
  getMessages(id: string): Promise<SessionMessage[]>;
  /** Append a single message to an existing session. */
  appendMessage(id: string, message: SessionMessage): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── Richer session types (used by @personaforge/production tenant module) ─────

export type SessionId = string;

export enum SessionState {
    ACTIVE = 'active',
    IDLE = 'idle',
    ARCHIVED = 'archived',
    EXPIRED = 'expired',
}

export interface SessionMetadata {
    readonly tags?: string[];
    readonly source?: string;
    readonly priority?: number;
    readonly [key: string]: unknown;
}

export interface Session {
    readonly id: SessionId;
    readonly agentId: string;
    readonly userId?: string;
    readonly state: SessionState;
    readonly messages: SessionMessage[];
    readonly metadata: SessionMetadata;
    readonly context: Record<string, unknown>;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly expiresAt?: Date;
}

export interface SessionRun {
    readonly id: string;
    readonly sessionId: SessionId;
    readonly agentId: string;
    readonly startTime: Date;
    readonly endTime?: Date;
    readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
    readonly steps: number;
    readonly result?: unknown;
    readonly error?: string;
}

export interface SessionQuery {
    readonly agentId?: string;
    readonly userId?: string;
    readonly state?: SessionState;
    readonly limit?: number;
    readonly before?: Date;
    readonly after?: Date;
}
