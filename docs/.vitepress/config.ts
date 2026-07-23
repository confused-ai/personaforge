import { defineConfig } from 'vitepress';

const base = process.env.BASE ?? '/';
const SITE_URL = process.env.SITE_URL ?? 'https://confused-ai.github.io/confused-ai';

export default defineConfig({
    base,
    title: 'Confused-AI',
    titleTemplate: ':title — Confused-AI | TypeScript AI Agent Framework',
    description: 'Build production-grade AI agents in TypeScript. 40+ LLM providers, 100+ built-in tools, multi-agent orchestration, RAG, guardrails, circuit breakers, HITL, budget enforcement, OTLP tracing. Open source. CrewAI / LangChain alternative.',

    lang: 'en-US',

    cleanUrls: true,
    lastUpdated: true,

    // Exclude internal planning/architecture docs from the built site
    srcExclude: [
        'PHASES.md',
        'ARCHITECTURE-SPECIFICATION.md',
        'COMPETITIVE-ANALYSIS.md',
        'INTEGRATION-BLUEPRINTS.md',
        'STRATEGIC-TRANSFORMATION-ROADMAP.md',
        'PRODUCTION-READINESS-AUDIT.md',
        'PROGRESS.md',
        'GLOSSARY.md',
        'TECHNICAL-AUDIT-2026-05-08.md',
        'src/content/docs/**',
    ],

    sitemap: {
        hostname: SITE_URL,
    },

    head: [
        // Favicon & theme
        ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
        ['link', { rel: 'shortcut icon', href: `${base}favicon.svg` }],
        ['meta', { name: 'theme-color', content: '#0f766e' }],

        // Open Graph
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Confused-AI' }],
        ['meta', { property: 'og:title', content: 'Confused-AI — TypeScript AI Agent Framework | Build Production AI Agents' }],
        ['meta', { property: 'og:description', content: 'Open-source TypeScript framework for production AI agents. 40+ LLM providers, 100+ tools, multi-agent teams, RAG, guardrails, circuit breakers, budget enforcement, OTLP tracing. CrewAI / LangChain alternative.' }],
        ['meta', { property: 'og:locale', content: 'en_US' }],
        ['meta', { property: 'og:image', content: `${SITE_URL}/og-banner.svg` }],
        ['meta', { property: 'og:image:alt', content: 'Confused-AI — TypeScript AI agent framework for building production LLM agents, teams, and workflows' }],
        ['meta', { property: 'og:url', content: SITE_URL }],

        // Twitter / X
        ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
        ['meta', { name: 'twitter:site', content: '@confusedai' }],
        ['meta', { name: 'twitter:title', content: 'Confused-AI — TypeScript AI Agent Framework' }],
        ['meta', { name: 'twitter:description', content: 'Build production AI agents in TypeScript. 40+ LLMs, 100+ tools, multi-agent teams, RAG, guardrails, budget caps — open source.' }],
        ['meta', { name: 'twitter:image', content: `${SITE_URL}/og-banner.svg` }],
        ['meta', { name: 'twitter:image:alt', content: 'Confused-AI — TypeScript AI agent framework for production LLM agents' }],

        // SEO
        ['meta', { name: 'keywords', content: 'AI agent framework TypeScript, build AI agents TypeScript, LLM orchestration framework, multi-agent system TypeScript, agentic AI framework, ReAct agent loop, autonomous AI agents, AI agent SDK, production AI agents, AI workflow automation, OpenAI agent framework, Anthropic Claude agents, Google Gemini agents, Groq LLM agents, Ollama local LLM agents, LLM router TypeScript, RAG TypeScript, retrieval augmented generation, vector store TypeScript, knowledge base AI, MCP model context protocol, tool use LLM, function calling LLM, HITL human in the loop AI, AI guardrails PII detection, prompt injection defense, circuit breaker LLM, AI rate limiting, budget enforcement LLM, cost control AI API, AI observability OTLP, OpenTelemetry AI agents, Prometheus AI metrics, AI eval framework, LLM judge evaluation, AI regression testing, AI session management, multi-tenant AI, AI scheduler cron, background queue AI, DAG workflow engine, durable execution AI, tree of thought reasoning, chain of thought AI, CrewAI alternative, LangChain alternative, LangGraph alternative, Agno alternative, AutoGen alternative, TypeScript LLM framework, Bun AI framework, AI agent starter kit, open source AI agent framework' }],
        ['meta', { name: 'author', content: 'Confused-AI contributors' }],
        ['meta', { name: 'robots', content: 'index, follow' }],
        ['meta', { name: 'google-site-verification', content: '' }],
        ['link', { rel: 'canonical', href: SITE_URL }],

        // Structured data (JSON-LD) — Google rich results for software / open-source projects
        [
            'script',
            { type: 'application/ld+json' },
            JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'SoftwareApplication',
                name: 'Confused-AI',
                alternateName: 'confused-ai TypeScript AI agent framework',
                applicationCategory: 'DeveloperApplication',
                operatingSystem: 'Cross-platform (Node.js, Bun)',
                programmingLanguage: 'TypeScript',
                description:
                    'Open-source TypeScript framework for building production-grade AI agents, multi-agent teams, and workflows. ' +
                    '30+ LLM providers, 100+ tools, RAG, guardrails, circuit breakers, rate limiting, budget enforcement, and OTLP tracing. ' +
                    'A CrewAI, LangChain, LangGraph, and Vercel AI SDK alternative.',
                url: SITE_URL,
                downloadUrl: 'https://www.npmjs.com/package/confused-ai',
                license: 'https://opensource.org/licenses/MIT',
                keywords:
                    'TypeScript AI agent framework, LLM agents, multi-agent orchestration, agentic AI, RAG, ' +
                    'guardrails, circuit breaker, rate limiting, budget enforcement, CrewAI alternative, LangChain alternative',
                offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            }),
        ],

        // Performance
        ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ],

    themeConfig: {
        logo: { src: '/logo.svg', alt: 'Confused-AI' },
        siteTitle: 'Confused-AI',

        nav: [
            { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
            { text: 'Examples', link: '/examples/', activeMatch: '/examples/' },
            { text: 'API Reference', link: '/api/', activeMatch: '/api/' },
            {
                text: 'Ecosystem',
                items: [
                    { text: '📦 All Modules', link: '/guide/all-modules' },
                    { text: '📦 Packages & Imports', link: '/guide/packages' },
                    { text: '🔌 Adapters System', link: '/guide/adapters' },
                    { text: '🧩 Plugins', link: '/guide/plugins' },
                    { text: '🤝 MCP Client', link: '/guide/mcp' },
                    { text: '🔁 LLM Router', link: '/guide/llm-router' },
                    { text: '🏗️ Providers (40+)', link: '/guide/providers' },
                    { text: '🎯 Skills', link: '/guide/skills' },
                    { text: '📊 Evaluation', link: '/guide/eval' },
                ],
            },
            {
                text: 'v2.4.2',
                items: [
                    { text: '📋 Changelog', link: '/changelog' },
                    { text: '📦 npm package', link: 'https://www.npmjs.com/package/confused-ai' },
                    { text: '🏷️ Releases', link: 'https://github.com/confused-ai/confused-ai/releases' },
                    { text: '🤝 Contributing', link: 'https://github.com/confused-ai/confused-ai/blob/main/CONTRIBUTING.md' },
                    { text: '🔒 Security', link: 'https://github.com/confused-ai/confused-ai/blob/main/SECURITY.md' },
                ],
            },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Introduction',
                    collapsed: false,
                    items: [
                        { text: 'Introduction', link: '/guide/introduction' },
                        { text: 'Getting Started', link: '/guide/getting-started' },
                        { text: 'Core Concepts', link: '/guide/concepts' },
                        { text: 'Packages & Imports', link: '/guide/packages' },
                        { text: 'All Modules Reference', link: '/guide/all-modules' },
                        { text: 'Adapters System', link: '/guide/adapters' },
                    ],
                },
                {
                    text: 'LLM Providers',
                    collapsed: false,
                    items: [
                        { text: 'Providers (40+)', link: '/guide/providers' },
                        { text: 'LLM Router', link: '/guide/llm-router' },
                        { text: 'Model Fallbacks & Retry', link: '/guide/model-fallbacks' },
                    ],
                },
                {
                    text: 'Building Agents',
                    collapsed: false,
                    items: [
                        { text: 'Creating Agents', link: '/guide/agents' },
                        { text: 'Skills', link: '/guide/skills' },
                        { text: 'Built-in Tools (100+)', link: '/guide/tools' },
                        { text: 'Tool Composition', link: '/guide/tool-composition' },
                        { text: 'Custom Tools', link: '/guide/custom-tools' },
                        { text: 'Toolkits', link: '/guide/toolkits' },
                        { text: 'Lifecycle Hooks', link: '/guide/hooks' },
                        { text: 'Compose & Pipe', link: '/guide/compose' },
                        { text: 'Runnable / LCEL', link: '/guide/runnable' },
                        { text: 'Output Parsers', link: '/guide/output-parsers' },
                        { text: 'Structured Output', link: '/guide/structured-output' },
                        { text: 'Vision & Multimodal', link: '/guide/vision' },
                        { text: 'Planner', link: '/guide/planner' },
                    ],
                },
                {
                    text: 'Data & Storage',
                    collapsed: false,
                    items: [
                        { text: 'RAG / Knowledge', link: '/guide/rag' },
                        { text: 'Advanced Retrieval', link: '/guide/retrieval-advanced' },
                        { text: 'Document Loaders', link: '/guide/loaders' },
                        { text: 'Memory', link: '/guide/memory' },
                        { text: 'Storage (KV/File)', link: '/guide/storage' },
                        { text: 'Session Management', link: '/guide/session' },
                        { text: 'Database Tools', link: '/guide/database' },
                    ],
                },
                {
                    text: 'Intelligence',
                    collapsed: false,
                    items: [
                        { text: 'Learning Machine', link: '/guide/learning-machine' },
                        { text: 'Reasoning (CoT)', link: '/guide/reasoning' },
                        { text: 'Reasoning Tools', link: '/guide/reasoning-tools' },
                        { text: 'Deep Research Agent', link: '/guide/deep-research' },
                        { text: 'Compression', link: '/guide/compression' },
                        { text: 'Context Providers', link: '/guide/context-provider' },
                        { text: 'Scheduler', link: '/guide/scheduler' },
                    ],
                },
                {
                    text: 'Multi-Agent',
                    collapsed: false,
                    items: [
                        { text: 'Orchestration', link: '/guide/orchestration' },
                        { text: 'Execution Workflows', link: '/guide/workflows' },
                        { text: 'Workflow Branching', link: '/guide/workflow-branching' },
                        { text: 'Graph Engine', link: '/guide/graph' },
                        { text: 'Team Modes', link: '/guide/team-modes' },
                        { text: 'Event Streaming', link: '/guide/event-streaming' },
                        { text: 'Durable Interrupt & Resume', link: '/guide/checkpoint' },
                        { text: 'MCP Client & Server', link: '/guide/mcp' },
                    ],
                },
                {
                    text: 'Output & Media',
                    collapsed: true,
                    items: [
                        { text: 'Artifacts', link: '/guide/artifacts' },
                        { text: 'Stream Utilities', link: '/guide/stream-utils' },
                        { text: 'Voice (TTS/STT)', link: '/guide/voice' },
                        { text: 'Video Generation', link: '/guide/video' },
                    ],
                },
                {
                    text: 'Quality & Testing',
                    collapsed: false,
                    items: [
                        { text: 'Evaluation & Benchmarking', link: '/guide/eval' },
                        { text: 'Trace ↔ Dataset Loop', link: '/guide/trace-dataset' },
                        { text: 'Guardrails & Safety', link: '/guide/guardrails' },
                        { text: 'Human-in-the-Loop (HITL)', link: '/guide/hitl' },
                    ],
                },
                {
                    text: 'Enterprise Production',
                    collapsed: false,
                    items: [
                        { text: 'Resilience & Circuit Breakers', link: '/guide/production' },
                        { text: 'Observability & OTLP', link: '/guide/observability' },
                        { text: 'Budget Enforcement', link: '/guide/production#budget-enforcement' },
                        { text: 'Multi-Tenancy', link: '/guide/multi-tenancy' },
                        { text: 'Background Queues', link: '/guide/background-queues' },
                        { text: 'WebSocket Transport', link: '/guide/websocket' },
                        { text: 'Admin API', link: '/guide/admin-api' },
                        { text: 'Control Plane', link: '/guide/control-plane' },
                        { text: 'Secret Manager', link: '/guide/secret-manager' },
                        { text: 'Plugins', link: '/guide/plugins' },
                    ],
                },
            ],

            '/examples/': [
                {
                    text: 'Quickstart',
                    items: [
                        { text: 'Overview', link: '/examples/' },
                        { text: '01 · Hello World', link: '/examples/01-hello-world' },
                        { text: '02 · First Custom Tool', link: '/examples/02-custom-tool' },
                        { text: '03 · Tool with Approval', link: '/examples/03-approval-tool' },
                        { text: '04 · Extend & Wrap Tools', link: '/examples/04-extend-tools' },
                    ],
                },
                {
                    text: 'Data & Knowledge',
                    items: [
                        { text: '05 · RAG Knowledge Base', link: '/examples/05-rag' },
                        { text: '06 · Persistent Memory', link: '/examples/06-memory' },
                        { text: '07 · Storage Patterns', link: '/examples/07-storage' },
                        { text: '10 · Database Analyst', link: '/examples/10-database' },
                    ],
                },
                {
                    text: 'Multi-Agent',
                    items: [
                        { text: '08 · Multi-Agent Team', link: '/examples/08-team' },
                        { text: '09 · Supervisor Workflow', link: '/examples/09-supervisor' },
                        { text: '16 · LLM Router', link: '/examples/16-llm-router' },
                    ],
                },
                {
                    text: 'Production',
                    items: [
                        { text: '11 · Customer Support Bot', link: '/examples/11-support-bot' },
                        { text: '12 · Observability & Hooks', link: '/examples/12-observability' },
                        { text: '13 · Production Resilience', link: '/examples/13-production' },
                        { text: '14 · MCP Filesystem Agent', link: '/examples/14-mcp' },
                        { text: '15 · Full-Stack App', link: '/examples/15-full-stack' },
                    ],
                },
                {
                    text: 'Showcases',
                    items: [
                        { text: '17 · Full Framework Showcase', link: '/examples/17-full-framework-showcase' },
                        { text: '18 · Meridian Platform', link: '/examples/18-meridian-platform' },
                    ],
                },
                {
                    text: 'Intelligence & Automation',
                    items: [
                        { text: '19 · Incident Triage Bot', link: '/examples/19-reasoning' },
                        { text: '20 · Scheduled Agent Jobs', link: '/examples/20-scheduled-agents' },
                        { text: '21 · Code Review Pipeline', link: '/examples/21-code-review-pipeline' },
                        { text: '22 · Eval Regression Guard', link: '/examples/22-eval-ci' },
                    ],
                },
            ],

            '/api/': [
                {
                    text: 'API Reference',
                    items: [
                        { text: 'Overview', link: '/api/' },
                        { text: 'agent() / createAgent()', link: '/api/agent' },
                        { text: 'tool() / defineTool()', link: '/api/tools' },
                        { text: 'KnowledgeEngine / createKnowledgeEngine()', link: '/api/knowledge' },
                        { text: 'createStorage()', link: '/api/storage' },
                        { text: 'Workflow / Orchestration', link: '/api/orchestration' },
                    ],
                },
            ],
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/confused-ai/confused-ai' },
            { icon: 'npm', link: 'https://www.npmjs.com/package/confused-ai' },
        ],

        footer: {
            message: 'Released under the <a href="https://github.com/confused-ai/confused-ai/blob/main/LICENSE">MIT License</a>.',
            copyright: 'Copyright © 2024-present Raja Shekar Reddy Vuyyuru',
        },

        search: {
            provider: 'local',
            options: {
                detailedView: true,
            },
        },

        editLink: {
            pattern: 'https://github.com/confused-ai/confused-ai/edit/main/docs/:path',
            text: 'Edit this page on GitHub',
        },

        lastUpdated: {
            text: 'Updated at',
            formatOptions: {
                dateStyle: 'medium',
                timeStyle: 'short',
            },
        },

        docFooter: {
            prev: 'Previous',
            next: 'Next',
        },

        outline: {
            level: [2, 3],
            label: 'On this page',
        },

        notFound: {
            title: 'Page Not Found',
            quote: "If you've followed a broken link, please open an issue on GitHub.",
            linkText: 'Back to home',
        },
    },

    markdown: {
        theme: { light: 'github-light', dark: 'one-dark-pro' },
        lineNumbers: true,
        image: {
            lazyLoading: true,
        },
        toc: { level: [2, 3] },
    },

    vite: {
        build: {
            chunkSizeWarningLimit: 1500,
        },
    },
});
