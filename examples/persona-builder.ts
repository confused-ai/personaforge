/**
 * Persona + persistent memory: SQLite session history + optional long-term facts file.
 *
 * - **Interactive by default** — type messages in the terminal; `exit` / `quit` / Ctrl+D to leave.
 * - One-shot: `bun examples/persona-builder.ts --single "your question"`
 * - Chat history survives restarts (same session resumed via `persona-agent-meta.json`).
 * - Copy `data/user-longterm.example.md` → `data/user-longterm.md` for stable facts (name, goals, …).
 *
 * Run: `bun run example:persona`  or  `bun examples/persona-builder.ts`
 *
 * SQLite: under **Bun** uses `bun:sqlite`. Under **Node**, install `better-sqlite3` (devDependency here).
 *
 * Requires: OPENAI_API_KEY (see examples/.env).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

import { Agent } from 'personaforge';
import { definePersona } from 'personaforge';
import { SessionState } from 'personaforge/session';
import type { SessionStore } from 'personaforge/session';
import type { AgenticRunResult } from 'personaforge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'persona-agent-sessions.db');
const SESSION_META_PATH = path.join(DATA_DIR, 'persona-agent-meta.json');
const LONGTERM_PATH = path.join(DATA_DIR, 'user-longterm.md');

const AGENT_NAME = 'SocraticTutor';
/** Stable user id for your machine; override with PERSONA_USER_ID */
const USER_ID = process.env.PERSONA_USER_ID?.trim() || 'primary-user';

interface SessionMeta {
    sessionId: string;
    userId: string;
}

async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function loadLongTermFacts(filePath: string): Promise<string | undefined> {
    try {
        const text = await readFile(filePath, 'utf8');
        const t = text.trim();
        return t.length > 0 ? t : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Resume the last session for this agent/user, or create one and persist its id.
 */
async function getOrResumeSessionId(
    store: SessionStore,
    metaPath: string,
    agentId: string,
    userId: string
): Promise<string> {
    await mkdir(path.dirname(metaPath), { recursive: true });
    const meta = await readJson<SessionMeta>(metaPath);
    if (meta?.sessionId) {
        const existing = await store.get(meta.sessionId);
        if (existing && existing.agentId === agentId) {
            return meta.sessionId;
        }
    }
    const session = await store.create({
        agentId,
        userId,
        state: SessionState.ACTIVE,
        messages: [],
        metadata: {},
        context: {},
    });
    await writeJson(metaPath, { sessionId: session.id, userId });
    return session.id;
}

const STORE_OPTS = {
    defaultTtlMs: 10 * 365 * 24 * 60 * 60 * 1000,
    maxMessagesPerSession: 2000,
} as const;

async function createPersistentSessionStore(): Promise<SessionStore> {
    if (typeof Bun !== 'undefined') {
        const { createBunSqliteSessionStore } = await import('../src/session/bun-sqlite-store.js');
        return createBunSqliteSessionStore(DB_PATH, STORE_OPTS);
    }
    const { createSqliteSessionStore } = await import('../src/session/sqlite-store.js');
    return createSqliteSessionStore(DB_PATH, STORE_OPTS);
}

function parseCliArgs(argv: string[]): { singleMode: boolean; text: string } {
    const args = [...argv];
    let singleMode = false;
    if (args[0] === '--single' || args[0] === '-1') {
        singleMode = true;
        args.shift();
    }
    return { singleMode, text: args.join(' ').trim() };
}

async function runTurn(agent: Agent, sessionId: string, prompt: string): Promise<AgenticRunResult> {
    return agent.run(prompt, { sessionId });
}

async function main() {
    const { singleMode, text: cliText } = parseCliArgs(process.argv.slice(2));

    await mkdir(DATA_DIR, { recursive: true });

    const longTerm = await loadLongTermFacts(LONGTERM_PATH);

    let baseInstructions = definePersona()
        .displayName(AGENT_NAME)
        .role('A math tutor who helps students discover answers through guided questions.')
        .tone('Patient and encouraging; never condescending.')
        .audience('High school students')
        .expertise(['algebra', 'word problems', 'study habits'])
        .constraints(['Do not solve the full problem upfront unless the student asks.', 'No medical or legal advice.'])
        .responseStyle('Short paragraphs; ask one focused question at a time when coaching.')
        .instructions();

    if (longTerm) {
        baseInstructions += `\n\n## Standing facts about this user (loaded from user-longterm.md)\n${longTerm}`;
    }

    const sessionStore = await createPersistentSessionStore();

    const sessionId = await getOrResumeSessionId(sessionStore, SESSION_META_PATH, AGENT_NAME, USER_ID);

    const agent = new Agent({
        name: AGENT_NAME,
        instructions: baseInstructions,
        db: sessionStore,
        learning: true,
        tools: [],
    });

    const history = await agent.getSessionMessages(sessionId);

    const printReply = (result: AgenticRunResult) => {
        console.log(`\n${AGENT_NAME}: ${result.text}`);
        console.log(`(finish: ${result.finishReason}, steps: ${result.steps})\n`);
    };

    if (singleMode) {
        const prompt =
            cliText ||
            'I keep mixing up when to use the quadratic formula vs factoring. Can you help?';
        console.log(`\n(session: ${sessionId}, user: ${USER_ID}, messages on disk: ${history.length})\n`);
        const result = await runTurn(agent, sessionId, prompt);
        printReply(result);
        console.log('Tip: run without --single for an interactive chat. History:', DB_PATH);
        if (!longTerm) {
            console.log(`Optional: ${LONGTERM_PATH}\n`);
        }
        return;
    }

    console.log(`
╔ ${AGENT_NAME} — interactive (session persists across runs)
║  session: ${sessionId}
║  user: ${USER_ID}  ·  messages in DB: ${history.length}
║  commands: exit | quit | :help
║  DB: ${DB_PATH}
${longTerm ? '║  long-term facts: loaded from user-longterm.md' : `║  tip: add ${LONGTERM_PATH} for standing facts`}
╚
`);

    const rl = readline.createInterface({ input, output, terminal: true });

    const help = () => {
        console.log(`  exit, quit     leave (session saved)
  :help          this text
  empty line     ignored
`);
    };

    rl.on('close', () => {
        console.log('\nBye — your thread is saved; run again to continue.\n');
    });

    const processLine = async (line: string): Promise<boolean> => {
        const trimmed = line.trim();
        if (!trimmed) {
            return true;
        }
        const lower = trimmed.toLowerCase();
        if (lower === 'exit' || lower === 'quit' || lower === ':q') {
            return false;
        }
        if (lower === ':help' || lower === 'help') {
            help();
            return true;
        }

        try {
            const result = await runTurn(agent, sessionId, trimmed);
            printReply(result);
        } catch (e) {
            console.error('Error:', e);
        }
        return true;
    };

    if (cliText) {
        const keepGoing = await processLine(cliText);
        if (!keepGoing) {
            rl.close();
            return;
        }
    }

    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const line = await rl.question('You: ');
            if (line === null || line === undefined) {
                break;
            }
            const keepGoing = await processLine(line);
            if (!keepGoing) {
                break;
            }
        }
    } finally {
        rl.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
