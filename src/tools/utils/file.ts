/**
 * File system tools implementation
 */

import { z } from 'zod';
import { BaseTool, BaseToolConfig } from '../core/base-tool.js';
import { ToolContext, ToolCategory, type ToolParameters } from '../core/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveWithin } from './safe-path.js';

/**
 * Base configuration for file tools
 */
export interface FileToolConfig extends Partial<Omit<BaseToolConfig<ToolParameters>, 'parameters'>> {
    baseDir?: string;
}

/**
 * Resolve `relativePath` strictly inside `baseDir`, rejecting traversal and
 * symlink escapes. Delegates to the shared {@link resolveWithin} guard.
 */
async function checkPath(baseDir: string, relativePath: string): Promise<string> {
    return resolveWithin(baseDir, relativePath);
}

// --- Write File Tool ---

const WriteFileParameters = z.object({
    fileName: z.string().describe('The name of the file to save to'),
    contents: z.string().describe('The contents to save'),
    overwrite: z.boolean().default(true).describe('Overwrite the file if it already exists'),
    encoding: z.enum(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'utf16le', 'ucs2']).default('utf-8').describe('Encoding to use'),
});

export class WriteFileTool extends BaseTool<typeof WriteFileParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_write_file',
            description: config?.description ?? 'Saves contents to a file',
            parameters: WriteFileParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof WriteFileParameters>, _context: ToolContext): Promise<string> {
        const { fileName, contents, overwrite, encoding } = params;
        const filePath = await checkPath(this.baseDir, fileName);

        // Check if directory exists
        const dir = path.dirname(filePath);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }

        // Check overwrite
        try {
            await fs.access(filePath);
            if (!overwrite) {
                return `File ${fileName} already exists`;
            }
        } catch {
            // File doesn't exist, proceed
        }

        await fs.writeFile(filePath, contents, encoding as BufferEncoding);
        return fileName;
    }
}

// --- Read File Tool ---

const ReadFileParameters = z.object({
    fileName: z.string().describe('The name of the file to read'),
    encoding: z.enum(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'utf16le', 'ucs2']).default('utf-8').describe('Encoding to use'),
});

export class ReadFileTool extends BaseTool<typeof ReadFileParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_read_file',
            description: config?.description ?? 'Reads the contents of a file',
            parameters: ReadFileParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof ReadFileParameters>, _context: ToolContext): Promise<string> {
        const { fileName, encoding } = params;
        const filePath = await checkPath(this.baseDir, fileName);

        try {
            const content = await fs.readFile(filePath, encoding as BufferEncoding);
            return content;
        } catch (error: unknown) {
            throw new Error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// --- Read File Chunk Tool ---

const ReadFileChunkParameters = z.object({
    fileName: z.string().describe('The name of the file to read'),
    startLine: z.number().int().min(0).describe('Number of first line in the returned chunk'),
    endLine: z.number().int().min(0).describe('Number of the last line in the returned chunk'),
    encoding: z.enum(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'utf16le', 'ucs2']).default('utf-8').describe('Encoding to use'),
});

export class ReadFileChunkTool extends BaseTool<typeof ReadFileChunkParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_read_file_chunk',
            description: config?.description ?? 'Reads specific lines from a file',
            parameters: ReadFileChunkParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof ReadFileChunkParameters>, _context: ToolContext): Promise<string> {
        const { fileName, startLine, endLine, encoding } = params;
        const filePath = await checkPath(this.baseDir, fileName);

        try {
            const content = await fs.readFile(filePath, encoding as BufferEncoding);
            const lines = content.split('\n');

            // Adjust endLine to not exceed total lines
            const actualEndLine = Math.min(endLine, lines.length - 1);

            if (startLine > actualEndLine) {
                return "";
            }

            return lines.slice(startLine, actualEndLine + 1).join('\n');
        } catch (error: unknown) {
            throw new Error(`Error reading file chunk: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// --- Replace File Chunk Tool ---

const ReplaceFileChunkParameters = z.object({
    fileName: z.string().describe('The name of the file to process'),
    startLine: z.number().int().min(0).describe('Number of first line in the replaced chunk'),
    endLine: z.number().int().min(0).describe('Number of the last line in the replaced chunk'),
    chunk: z.string().describe('String to be inserted instead of lines from start_line to end_line'),
    encoding: z.enum(['utf-8', 'utf8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'utf16le', 'ucs2']).default('utf-8').describe('Encoding to use'),
});

export class UpdateFileChunkTool extends BaseTool<typeof ReplaceFileChunkParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_update_file_chunk',
            description: config?.description ?? 'Replaces specific lines in a file with new content',
            parameters: ReplaceFileChunkParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof ReplaceFileChunkParameters>, _context: ToolContext): Promise<string> {
        const { fileName, startLine, endLine, chunk, encoding } = params;
        const filePath = await checkPath(this.baseDir, fileName);

        try {
            const content = await fs.readFile(filePath, encoding as BufferEncoding);
            const lines = content.split('\n');

            const start = lines.slice(0, startLine);
            const end = lines.slice(endLine + 1);

            const newContent = [...start, chunk, ...end].join('\n');

            await fs.writeFile(filePath, newContent, encoding as BufferEncoding);
            return fileName;
        } catch (error: unknown) {
            throw new Error(`Error updating file chunk: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}


// --- Delete File Tool ---

const DeleteFileParameters = z.object({
    fileName: z.string().describe('Name of the file to delete'),
});

export class DeleteFileTool extends BaseTool<typeof DeleteFileParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_delete_file',
            description: config?.description ?? 'Deletes a file',
            parameters: DeleteFileParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof DeleteFileParameters>, _context: ToolContext): Promise<string> {
        const { fileName } = params;
        const filePath = await checkPath(this.baseDir, fileName);

        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                await fs.rmdir(filePath);
            } else {
                await fs.unlink(filePath);
            }
            return "";
        } catch (error: unknown) {
            throw new Error(`Error deleting file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// --- List Files Tool ---

const ListFilesParameters = z.object({
    directory: z.string().optional().default('.').describe('Name of directory to list'),
});

export class ListFilesTool extends BaseTool<typeof ListFilesParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_list_files',
            description: config?.description ?? 'Returns a list of files in a directory',
            parameters: ListFilesParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof ListFilesParameters>, _context: ToolContext): Promise<string> {
        const { directory } = params;
        const targetDir = await checkPath(this.baseDir, directory ?? '.');

        try {
            const files = await fs.readdir(targetDir, { withFileTypes: true, recursive: false });
            // Return paths relative to the configured base directory.

            const paths = files.map(f => {
                const fullPath = path.join(targetDir, f.name);
                return path.relative(this.baseDir, fullPath);
            });

            return JSON.stringify(paths, null, 4);
        } catch {
            return "{}"; // Safe default on read errors when listing
        }
    }
}

// --- Search Files Tool ---

const SearchFilesParameters = z.object({
    pattern: z.string().describe('The pattern to search for, e.g. "*.txt", "src/**/*.ts"'),
});

// Node has no built-in glob; this uses a small recursive walk with simple pattern matching.
// For now, let's just list recursively and filter by extension/name if simple.
// Or I can just check if `glob` package is available? I don't see it in package.json (I haven't checked).
// I'll use a simple recursive directory walker and manual matching.

export class SearchFilesTool extends BaseTool<typeof SearchFilesParameters, string> {
    private baseDir: string;

    constructor(config?: FileToolConfig) {
        super({
            name: config?.name ?? 'fs_search_files',
            description: config?.description ?? 'Searches for files in the base directory that match the pattern',
            parameters: SearchFilesParameters,
            category: config?.category ?? ToolCategory.FILE_SYSTEM,
            permissions: {
                allowFileSystem: true,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir ?? process.cwd();
    }

    protected async performExecute(params: z.infer<typeof SearchFilesParameters>, _context: ToolContext): Promise<string> {
        const { pattern } = params;

        if (!pattern || !pattern.trim()) {
            return "Error: Pattern cannot be empty";
        }

        try {
            const files: string[] = [];

            // Simple recursive walker
            const walk = async (dir: string) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                    } else {
                        // Simple pattern matching
                        // If pattern contains *, convert to regex
                        // This is a naive implementation
                        if (this.matches(entry.name, pattern) || this.matches(path.relative(this.baseDir, fullPath), pattern)) {
                            files.push(path.relative(this.baseDir, fullPath));
                        }
                    }
                }
            };

            await walk(this.baseDir);

            const result = {
                pattern,
                matches_found: files.length,
                files
            };
            return JSON.stringify(result, null, 2);

        } catch (error: unknown) {
            return `Error searching files with pattern '${pattern}': ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private matches(text: string, pattern: string): boolean {
        // Very basic wildcard support: escape every regex metacharacter
        // first, then restore glob `*`/`?` — an unescaped `(` or `[` in the
        // pattern must not throw or change matching semantics.
        const regexString = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexString}$`);
        return regex.test(text);
    }
}
