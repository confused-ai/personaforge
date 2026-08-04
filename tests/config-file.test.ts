/**
 * Hermetic unit tests for `loadConfigFile` (src/config/file-loader) — JSONC
 * parsing, env-default merging, and validation. Uses temp files; no network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile } from '../src/config/file-loader.js';

describe('loadConfigFile', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pf-config-'));
        // Deterministic env defaults so merge behavior is testable.
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'env-key';
        process.env.OPENAI_MODEL = 'env-model';
        process.env.DB_TYPE = 'sqlite';
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        delete process.env.LLM_PROVIDER;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_MODEL;
        delete process.env.DB_TYPE;
    });

    const write = (name: string, content: string): string => {
        const p = join(dir, name);
        writeFileSync(p, content, 'utf8');
        return p;
    };

    it('parses a JSONC file with comments and trailing commas', () => {
        const p = write(
            'config.jsonc',
            `{
                // pick a provider
                "llm": {
                    "provider": "openai",
                    "apiKey": "file-key", // overrides env
                    "model": "file-model",
                },
            }`,
        );
        const config = loadConfigFile(p);
        expect(config.llm.apiKey).toBe('file-key');
        expect(config.llm.model).toBe('file-model');
        // Untouched sections fall back to env defaults.
        expect(config.database.type).toBe('sqlite');
    });

    it('parses strict JSON too', () => {
        const p = write('config.json', JSON.stringify({ llm: { provider: 'openai', apiKey: 'k', model: 'm' } }));
        const config = loadConfigFile(p);
        expect(config.llm.model).toBe('m');
    });

    it('merges partial sections over env defaults without wiping the rest', () => {
        const p = write('config.jsonc', `{ "server": { "port": 9999 } }`);
        const config = loadConfigFile(p);
        expect(config.server.port).toBe(9999);
        // llm still from env
        expect(config.llm.model).toBe('env-model');
        expect(config.database.type).toBe('sqlite');
    });

    it('throws a helpful error for a missing file', () => {
        expect(() => loadConfigFile(join(dir, 'nope.jsonc'))).toThrow(/Config file not found/);
    });

    it('throws a helpful error for invalid JSONC', () => {
        const p = write('bad.jsonc', '{ "llm": { "provider": } }');
        expect(() => loadConfigFile(p)).toThrow(/not valid JSON\/JSONC/);
    });

    it('throws for a non-object root', () => {
        const p = write('arr.jsonc', '[1, 2, 3]');
        expect(() => loadConfigFile(p)).toThrow(/must contain a JSON object/);
    });

    it('validates the merged result and surfaces config errors', () => {
        // Force a validation failure: no apiKey anywhere.
        delete process.env.OPENAI_API_KEY;
        const p = write('config.jsonc', `{ "llm": { "provider": "openai", "model": "m" } }`);
        expect(() => loadConfigFile(p)).toThrow(/LLM API key is required/);
    });

    it('lets explicit overrides win over the file', () => {
        const p = write('config.jsonc', `{ "llm": { "provider": "openai", "apiKey": "file-key", "model": "m" } }`);
        const config = loadConfigFile(p, { llm: { provider: 'openai', apiKey: 'override', model: 'm' } });
        expect(config.llm.apiKey).toBe('override');
    });
});
