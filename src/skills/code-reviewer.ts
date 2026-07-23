/**
 * Code Reviewer Skill
 *
 * Provides a `read_file` tool that loads source files from disk, enabling
 * the agent to review code, spot bugs, suggest improvements, and explain
 * logic — all grounded in the actual file content.
 *
 * Usage:
 * ```ts
 * import { codeReviewerSkill } from './index.js';
 * import { agent } from 'personaforge';
 *
 * const bot = agent({
 *   name: 'CodeReviewer',
 *   skills: [codeReviewerSkill],
 * });
 * const result = await bot.run('Review src/auth/jwt.ts for security issues.');
 * ```
 */

import type { Skill, Tool } from '../contracts/index.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ── Supported extensions ──────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.json', '.toml', '.env',
  '.sql', '.graphql',
  '.md', '.txt',
]);

// ── read_source_file tool ─────────────────────────────────────────────────────

const readSourceFileTool: Tool = {
  name: 'read_source_file',
  description:
    'Read the content of a source code file for review. ' +
    'Only text-based source files are supported (TS, JS, Python, Go, etc.). ' +
    'Binary files are rejected. Returns the file content as a string.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the source file (relative or absolute).',
      },
      startLine: {
        type: 'number',
        description: 'First line to return (1-indexed). Default: 1.',
      },
      endLine: {
        type: 'number',
        description: 'Last line to return (inclusive). Default: return all lines.',
      },
    },
    required: ['path'],
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = input['path'] as string;
    const startLine = (input['startLine'] as number | undefined) ?? 1;
    const endLine = input['endLine'] as number | undefined;

    // Extension allow-list checked first — gives clearer error for binary paths
    // regardless of whether the file exists.
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(
        `read_source_file: "${ext}" files are not supported for review. ` +
        `Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      );
    }

    if (!existsSync(filePath)) {
      throw new Error(`read_source_file: file not found at "${filePath}".`);
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const start = Math.max(0, startLine - 1);
    const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

    return lines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n');
  },
};

// ── Skill definition ──────────────────────────────────────────────────────────

export const codeReviewerSkill: Skill = {
  id: 'code-reviewer',
  name: 'Code Reviewer',
  description:
    'Review source code files for bugs, security issues, and improvements.',
  instructions:
    'You are an expert code reviewer. Use the read_source_file tool to read any ' +
    'source file the user mentions. After reading, provide a structured review: ' +
    '1) Summary of what the code does, ' +
    '2) Bugs or correctness issues (if any), ' +
    '3) Security concerns (if any), ' +
    '4) Style and readability suggestions, ' +
    '5) Overall verdict. ' +
    'Be specific — reference line numbers when pointing out issues.',
  tools: [readSourceFileTool],
  metadata: {
    version: '1.0.0',
    category: 'development',
    tags: ['code', 'review', 'security', 'typescript', 'python'],
  },
};
