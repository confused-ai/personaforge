/**
 * @personaforge/tools — file system tool.
 * Uses built-in node:fs/promises — zero external deps.
 *
 * SECURITY: every path is resolved inside a sandbox root (default:
 * `CONFUSED_AI_FS_ROOT` env, else cwd) via {@link resolveWithin}, which rejects
 * `../` traversal, absolute-path and sibling-dir escapes, and symlink escapes.
 * Pass an explicit root with {@link createFileSystemTool}.
 */

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defineTool } from './types.js';
import { resolveWithin, sandboxRoot } from './utils/safe-path.js';

const FsInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'),   filePath: z.string() }),
  z.object({ operation: z.literal('write'),  filePath: z.string(), content: z.string() }),
  z.object({ operation: z.literal('append'), filePath: z.string(), content: z.string() }),
  z.object({ operation: z.literal('delete'), filePath: z.string() }),
  z.object({ operation: z.literal('list'),   dirPath:  z.string() }),
  z.object({ operation: z.literal('exists'), filePath: z.string() }),
]);

/**
 * Build a filesystem tool sandboxed to `root` (default: `CONFUSED_AI_FS_ROOT`
 * env or the current working directory).
 */
export function createFileSystemTool(opts?: { root?: string }) {
  const root = sandboxRoot(opts?.root);
  return defineTool({
    name:        'file_system',
    description: 'Read, write, append, delete files or list directories within the sandbox root.',
    parameters:  FsInputSchema,
    async execute(input) {
      switch (input.operation) {
        case 'read': {
          const p = await resolveWithin(root, input.filePath);
          const content = await fs.readFile(p, 'utf-8');
          return { content, bytes: Buffer.byteLength(content) };
        }
        case 'write': {
          const p = await resolveWithin(root, input.filePath);
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, input.content, 'utf-8');
          return { written: true, bytes: Buffer.byteLength(input.content) };
        }
        case 'append': {
          const p = await resolveWithin(root, input.filePath);
          await fs.appendFile(p, input.content, 'utf-8');
          return { appended: true };
        }
        case 'delete': {
          const p = await resolveWithin(root, input.filePath);
          await fs.unlink(p);
          return { deleted: true };
        }
        case 'list': {
          const p = await resolveWithin(root, input.dirPath);
          const entries = await fs.readdir(p, { withFileTypes: true });
          // Sort: directories first, then files (both alphabetically) — O(n log n)
          return entries
            .sort((a, b) => {
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
        }
        case 'exists': {
          const p = await resolveWithin(root, input.filePath);
          const exists = await fs.access(p).then(() => true).catch(() => false);
          return { exists };
        }
      }
    },
  });
}

/** Default filesystem tool, sandboxed to `CONFUSED_AI_FS_ROOT` or cwd. */
export const fileSystem = createFileSystemTool();
