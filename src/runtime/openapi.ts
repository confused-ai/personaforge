/**
 * OpenAPI 3.0 document for the built-in {@link createHttpService} routes.
 * Same paths are also exposed at legacy unversioned URLs (`/health`, `/chat`, etc.).
 */
export function getRuntimeOpenApiJson(): Record<string, unknown> {
    return {
        openapi: '3.0.3',
        info: {
            title: 'personaforge HTTP runtime',
            version: '1.0.0',
            description:
                'Stateless Node HTTP service: health, agent listing, session creation, and chat (JSON or SSE).',
        },
        paths: {
            '/v1/health': {
                get: {
                    operationId: 'getHealth',
                    summary: 'Liveness probe',
                    responses: {
                        '200': {
                            description: 'Service is up',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['status', 'service', 'time'],
                                        properties: {
                                            status: { type: 'string', example: 'ok' },
                                            service: { type: 'string', example: 'personaforge' },
                                            time: { type: 'string', format: 'date-time' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/agents': {
                get: {
                    operationId: 'listAgents',
                    summary: 'List registered agent keys',
                    responses: {
                        '200': {
                            description: 'Named agents',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['agents'],
                                        properties: {
                                            agents: {
                                                type: 'array',
                                                items: {
                                                    type: 'object',
                                                    required: ['name', 'title'],
                                                    properties: {
                                                        name: { type: 'string' },
                                                        title: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/sessions': {
                post: {
                    operationId: 'createSession',
                    summary: 'Create a new session (uses first registered agent)',
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { userId: { type: 'string' } },
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'Session id',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['sessionId', 'defaultAgent'],
                                        properties: {
                                            sessionId: { type: 'string' },
                                            defaultAgent: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/openapi.json': {
                get: {
                    operationId: 'getOpenApi',
                    summary: 'This OpenAPI document',
                    responses: {
                        '200': {
                            description: 'OpenAPI 3.0 JSON',
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/chat': {
                post: {
                    operationId: 'postChat',
                    summary: 'Run agent turn (JSON or Server-Sent Events)',
                    description:
                        'Default response is `application/json`. For SSE, set request header `Accept: text/event-stream` and/or body `"stream": true`. Events are `data: ` lines with JSON objects: `{ type: "chunk", text }`, then `{ type: "done", ... }` matching the non-streaming response shape, or `{ type: "error", message }`.',
                    parameters: [
                        {
                            name: 'X-Session-Id',
                            in: 'header',
                            required: false,
                            schema: { type: 'string' },
                        },
                        {
                            name: 'X-Request-Id',
                            in: 'header',
                            required: false,
                            schema: { type: 'string' },
                        },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['message'],
                                    properties: {
                                        message: { type: 'string' },
                                        agent: { type: 'string' },
                                        sessionId: { type: 'string' },
                                        userId: { type: 'string' },
                                        stream: {
                                            type: 'boolean',
                                            description: 'If true, respond with `text/event-stream` (SSE)',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Reply or event stream',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['id', 'agent', 'sessionId', 'text', 'steps', 'finishReason'],
                                        properties: {
                                            id: { type: 'string' },
                                            agent: { type: 'string' },
                                            sessionId: { type: 'string' },
                                            text: { type: 'string' },
                                            steps: { type: 'number' },
                                            finishReason: { type: 'string' },
                                        },
                                    },
                                },
                                'text/event-stream': {
                                    schema: { type: 'string', example: 'data: {"type":"chunk","text":"Hi"}\n\n' },
                                },
                            },
                        },
                        '400': {
                            description: 'Bad request',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: { error: { type: 'string' } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/approvals': {
                get: {
                    operationId: 'listApprovals',
                    summary: 'List pending human-in-the-loop approval requests',
                    responses: {
                        '200': {
                            description: 'Pending approvals (empty array when no store is configured)',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['approvals'],
                                        properties: {
                                            approvals: { type: 'array', items: { type: 'object' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/v1/approvals/{id}': {
                post: {
                    operationId: 'decideApproval',
                    summary: 'Submit an approval decision (approve or reject)',
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['approved'],
                                    properties: {
                                        approved: { type: 'boolean' },
                                        comment: { type: 'string' },
                                        decidedBy: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': { description: 'Updated approval request', content: { 'application/json': { schema: { type: 'object' } } } },
                        '404': { description: 'Approval not found', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
                    },
                },
            },
        },
    };
}
