/**
 * Message Bus Implementation
 *
 * Handles inter-agent communication with pub/sub pattern
 */

import {
    MessageBus,
    AgentMessage,
    MessageType,
    MessageFilter,
    MessageHandler,
    Subscription,
    MessagePriority,
} from './types.js';
import type { EntityId } from '../../core/index.js';

/**
 * Message bus implementation
 */
export interface MessageBusOptions {
    /** Called when a subscriber handler throws (delivery to others continues). Default: console.error. */
    onSubscriberError?: (err: unknown, message: AgentMessage) => void;
}

export class MessageBusImpl implements MessageBus {
    constructor(private readonly opts: MessageBusOptions = {}) {}
    private messages: AgentMessage[] = [];
    private static readonly MAX_HISTORY = 10_000; // cap to prevent unbounded growth
    private subscriptions: Map<EntityId, Set<SubscriptionImpl>> = new Map();
    private pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }> = new Map();
    private messageCounter = 0;

    private reportSubscriberError(error: unknown, message: AgentMessage): void {
        try {
            if (this.opts.onSubscriberError) this.opts.onSubscriberError(error, message);
            else console.error('Error handling message:', error);
        } catch {
            // Error hook must never break delivery.
        }
    }

    async send(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage> {
        const fullMessage: AgentMessage = {
            ...message,
            id: this.generateId(),
            timestamp: new Date(),
        };

        this.messages.push(fullMessage);

        // Evict oldest messages when history exceeds cap
        if (this.messages.length > MessageBusImpl.MAX_HISTORY) {
            this.messages.shift();
        }

        // Deliver to subscribers
        await this.deliverMessage(fullMessage);

        return fullMessage;
    }

    subscribe(
        subscriberId: EntityId,
        filter: MessageFilter,
        handler: MessageHandler
    ): Subscription {
        const subscription: SubscriptionImpl = {
            id: this.generateId(),
            subscriberId,
            filter,
            handler,
            unsubscribe: () => {
                const subs = this.subscriptions.get(subscriberId);
                if (subs) {
                    subs.delete(subscription);
                }
            },
        };

        if (!this.subscriptions.has(subscriberId)) {
            this.subscriptions.set(subscriberId, new Set());
        }

        this.subscriptions.get(subscriberId)!.add(subscription);

        return subscription;
    }

    unsubscribe(subscription: Subscription): void {
        subscription.unsubscribe();
    }

    async request<T>(to: EntityId, payload: unknown, timeoutMs = 30000): Promise<T> {
        const correlationId = this.generateId();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(correlationId);
                reject(new Error(`Request timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout,
            });

            // Send request message
            this.send({
                from: 'orchestrator',
                to,
                type: MessageType.QUERY,
                payload,
                priority: MessagePriority.HIGH,
                correlationId,
            }).catch(reject);
        });
    }

    /**
     * Respond to a request
     */
    async respond(correlationId: string, payload: unknown): Promise<void> {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(correlationId);
            pending.resolve(payload);
        }
    }

    /**
     * Get message history
     */
    getMessages(filter?: MessageFilter): AgentMessage[] {
        if (!filter) {
            return [...this.messages];
        }
        // Use for-loop to avoid allocating an intermediate filtered array
        const result: AgentMessage[] = [];
        for (const msg of this.messages) {
            if (this.matchesFilter(msg, filter)) result.push(msg);
        }
        return result;
    }

    private async deliverMessage(message: AgentMessage): Promise<void> {
        const targetId = message.to;

        if (targetId === 'broadcast') {
            // Deliver to all subscribers
            for (const [_, subs] of this.subscriptions) {
                for (const sub of subs) {
                    if (this.matchesFilter(message, sub.filter)) {
                        try {
                            await sub.handler(message);
                        } catch (error) {
                            this.reportSubscriberError(error, message);
                        }
                    }
                }
            }
        } else {
            // Deliver to specific subscriber
            const subs = this.subscriptions.get(targetId);
            if (subs) {
                for (const sub of subs) {
                    if (this.matchesFilter(message, sub.filter)) {
                        try {
                            await sub.handler(message);
                        } catch (error) {
                            this.reportSubscriberError(error, message);
                        }
                    }
                }
            }
        }

        // Handle response messages
        if (message.correlationId && message.type === MessageType.TASK_RESPONSE) {
            await this.respond(message.correlationId, message.payload);
        }
    }

    private matchesFilter(message: AgentMessage, filter: MessageFilter): boolean {
        if (filter.from && message.from !== filter.from) {
            return false;
        }

        if (filter.types && !filter.types.includes(message.type)) {
            return false;
        }

        if (filter.correlationId && message.correlationId !== filter.correlationId) {
            return false;
        }

        if (filter.minPriority !== undefined && message.priority > filter.minPriority) {
            return false;
        }

        return true;
    }

    private generateId(): string {
        return `msg-${Date.now()}-${++this.messageCounter}`;
    }
}

/**
 * Subscription implementation
 */
interface SubscriptionImpl extends Subscription {
    filter: MessageFilter;
    handler: MessageHandler;
}
