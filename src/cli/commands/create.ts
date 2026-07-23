import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES: Record<string, { description: string; files: Record<string, (name: string) => string> }> = {
    basic: {
        description: 'Minimal agent with one LLM call',
        files: {
            'agent.ts': (name: string) => `import { createAgent } from 'personaforge';

const agent = createAgent({
  name: '${name}',
  instructions: 'You are a helpful assistant.',
  // model: 'gpt-4o', // or set OPENAI_MODEL env var
});

export async function run(input: string) {
  const result = await agent.run(input || 'Hello!');
  return result.text;
}

// Run directly: bun agent.ts
if (import.meta.main) {
  const result = await agent.run(process.argv[2] ?? 'Hello!');
  console.log(result.text);
}
`,
            'package.json': (name: string) => JSON.stringify({
                name: name.toLowerCase().replace(/\s+/g, '-'),
                type: 'module',
                scripts: {
                    start: 'bun agent.ts',
                    serve: 'personaforge serve agent.ts',
                    typecheck: 'tsc --noEmit',
                },
                dependencies: {
                    'personaforge': '*',
                    openai: '^6.0.0',
                },
                devDependencies: {
                    typescript: '^5.0.0',
                    '@types/bun': 'latest',
                },
            }, null, 2) + '\n',
            'tsconfig.json': () => JSON.stringify({
                compilerOptions: {
                    target: 'ES2022',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    strict: true,
                    esModuleInterop: true,
                    skipLibCheck: true,
                    types: ['bun-types'],
                },
            }, null, 2) + '\n',
            '.env.example': () => `# LLM Provider — set at least one
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=...
# GOOGLE_AI_API_KEY=...

# Optional: default model
# OPENAI_MODEL=gpt-4o
`,
            'README.md': (name: string) => `# ${name}

An AI agent built with [personaforge](https://github.com/personaforge/personaforge).

## Getting started

\`\`\`bash
cp .env.example .env
# Edit .env and add your API key

bun install
bun agent.ts "Hello!"
\`\`\`

## Serve as an HTTP API

\`\`\`bash
personaforge serve agent.ts --port 3000
# POST http://localhost:3000/v1/chat
# { "message": "Hello!" }
\`\`\`
`,
        },
    },

    http: {
        description: 'Agent exposed as an HTTP API (JSON + SSE)',
        files: {
            'agent.ts': (name: string) => `import { createAgent } from 'personaforge';
import { createHttpService, listenService } from '../../runtime/index.js';

export const agent = createAgent({
  name: '${name}',
  instructions: 'You are a helpful assistant.',
});

// HTTP service — POST /v1/chat
const svc = createHttpService({ agents: { assistant: agent }, cors: '*' });
const { port } = await listenService(svc);
console.log(\`Listening on http://localhost:\${port}\`);
`,
            'package.json': (name: string) => JSON.stringify({
                name: name.toLowerCase().replace(/\s+/g, '-'),
                type: 'module',
                scripts: {
                    start: 'bun agent.ts',
                    dev: 'bun --watch agent.ts',
                },
                dependencies: { 'personaforge': '*', openai: '^6.0.0' },
                devDependencies: { typescript: '^5.0.0', '@types/bun': 'latest' },
            }, null, 2) + '\n',
            '.env.example': () => `OPENAI_API_KEY=sk-...\nPORT=8787\n`,
        },
    },
};

function writeFile(dir: string, filename: string, content: string): void {
    const fullPath = path.join(dir, filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`  created  ${filename}`);
    } else {
        console.log(`  exists   ${filename} (skipped)`);
    }
}

export function registerCreateCommand(program: Command): void {
    program
        .command('create')
        .description('Scaffold a new agent project')
        .argument('<name>', 'Project name')
        .option('-t, --template <template>', `Template: ${Object.keys(TEMPLATES).join(' | ')}`, 'basic')
        .option('-d, --directory <directory>', 'Target directory (defaults to <name>)')
        .action((name, options) => {
            const template = TEMPLATES[options.template as string];
            if (!template) {
                console.error(`Unknown template: ${options.template as string}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
                process.exit(1);
            }

            const projectDir = path.resolve(options.directory ?? name);
            fs.mkdirSync(projectDir, { recursive: true });

            console.log(`\nScaffolding "${name}" (template: ${options.template as string})`);
            for (const [filename, contentFn] of Object.entries(template.files)) {
                writeFile(projectDir, filename, contentFn(name));
            }

            console.log(`\n✅  Done! Next steps:\n`);
            console.log(`  cd ${path.relative(process.cwd(), projectDir)}`);
            console.log(`  cp .env.example .env`);
            console.log(`  # Add your API key to .env`);
            console.log(`  bun install`);
            console.log(`  bun agent.ts "Hello!"\n`);
        });
}
