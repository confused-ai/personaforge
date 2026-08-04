/**
 * File-based configuration loader — reads a `personaforge.config.json` /
 * `personaforge.config.jsonc` file and merges it over the environment-driven
 * defaults from {@link loadConfig}.
 *
 * JSONC (comments + trailing commas) is accepted so config files can carry
 * explanatory comments in production. Strict JSON is also fine.
 *
 * ```ts
 * import { loadConfigFile } from 'personaforge/config';
 * const config = loadConfigFile('personaforge.config.jsonc');
 * ```
 */

import { readFileSync } from 'node:fs';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import type { AppConfig } from './types.js';
import { loadConfig } from './loader.js';
import { validateConfig } from './validator.js';
import { AgentError, ErrorCode } from '../shared/index.js';

/** Keys of {@link AppConfig} that can be overridden from a config file. */
type ConfigFileShape = Partial<AppConfig>;

/**
 * Load configuration from a JSON/JSONC file, merged over the environment-driven
 * defaults. File values win over env defaults; the result is validated with the
 * same rules as {@link loadConfig}.
 *
 * @param filePath Path to the config file (`.json` or `.jsonc`).
 * @param overrides Optional partial config that takes precedence over the file.
 * @throws AgentError with `CONFIG_ERROR` if the file is missing, unparseable, or
 *         fails validation.
 */
export function loadConfigFile(filePath: string, overrides?: Partial<AppConfig>): AppConfig {
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf8');
    } catch (e) {
        throw new AgentError(`Config file not found: ${filePath}`, {
            code: ErrorCode.CONFIG_ERROR,
            cause: e instanceof Error ? e : undefined,
        });
    }

    const errors: ParseError[] = [];
    let parsed: unknown;
    try {
        // jsonc-parser tolerates comments + trailing commas; strict JSON parses
        // cleanly through the same path.
        parsed = parseJsonc(raw, errors, { allowTrailingComma: true, disallowComments: false });
    } catch (e) {
        throw new AgentError(`Config file is not valid JSON/JSONC: ${filePath}`, {
            code: ErrorCode.CONFIG_ERROR,
            cause: e instanceof Error ? e : undefined,
        });
    }
    if (errors.length > 0) {
        const detail = errors
            .map((e) => `${printParseErrorCode(e.error as never) ?? 'syntax error'} at offset ${e.offset}`)
            .join('; ');
        throw new AgentError(`Config file is not valid JSON/JSONC: ${filePath} (${detail})`, {
            code: ErrorCode.CONFIG_ERROR,
        });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AgentError(`Config file must contain a JSON object: ${filePath}`, {
            code: ErrorCode.CONFIG_ERROR,
        });
    }

    const fileConfig = parsed as ConfigFileShape;
    const base = loadConfig();
    // Merge section-by-section so a partial file doesn't wipe env-driven defaults.
    const merged: AppConfig = {
        ...base,
        ...fileConfig,
        llm: { ...base.llm, ...fileConfig.llm },
        database: { ...base.database, ...fileConfig.database },
        server: { ...base.server, ...fileConfig.server },
        logging: { ...base.logging, ...fileConfig.logging },
        guardrails: { ...base.guardrails, ...fileConfig.guardrails },
        resilience: { ...base.resilience, ...fileConfig.resilience },
        session: { ...base.session, ...fileConfig.session },
        ...overrides,
    };

    const validated = validateConfig(merged);
    const { errors: _validationErrors, ...appConfig } = validated;
    return appConfig as AppConfig;
}
