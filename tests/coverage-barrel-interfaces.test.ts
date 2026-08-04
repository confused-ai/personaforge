/**
 * Coverage for src/interfaces.ts (barrel) — messaging/platform surface adapters.
 * Constructors + setup() against a throwaway HTTP server (no network traffic).
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
    SlackInterface,
    TelegramInterface,
    A2AInterface,
    AGUIInterface,
    BaseInterface,
} from '../src/interfaces.js';
import { createMockAgent } from '../src/test.js';

const agent = createMockAgent({ name: 'IFA', instructions: 'i', responses: ['hi'] });

describe('interfaces barrel', () => {
    it('BaseInterface is exported as an abstract class', () => {
        expect(typeof BaseInterface).toBe('function');
    });

    it('SlackInterface constructs and registers routes on a server', () => {
        const iface = new SlackInterface({ agent: agent as never, token: 'x', signingSecret: 'y' } as never);
        const server = createServer();
        expect(() => iface.setup(server)).not.toThrow();
        server.close();
    });

    it('TelegramInterface constructs and registers routes on a server', () => {
        const iface = new TelegramInterface({ agent: agent as never, token: 't' } as never);
        const server = createServer();
        expect(() => iface.setup(server)).not.toThrow();
        server.close();
    });

    it('A2AInterface constructs with an agent card and registers routes', () => {
        const iface = new A2AInterface({
            agent: agent as never,
            agentCard: { name: 'a', url: 'https://x', capabilities: {} } as never,
        } as never);
        const server = createServer();
        expect(() => iface.setup(server)).not.toThrow();
        server.close();
    });

    it('AGUIInterface constructs and registers routes on a server', () => {
        const iface = new AGUIInterface({ agent: agent as never } as never);
        const server = createServer();
        expect(() => iface.setup(server)).not.toThrow();
        server.close();
    });
});
