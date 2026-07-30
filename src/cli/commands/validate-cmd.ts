import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parse } from '../../validation/index.js';

export function registerValidateCommand(program: Command): void {
    program
        .command('validate')
        .description('Validate agent configuration (JSON file)')
        .argument('<file>', 'Configuration file path')
        .action((file) => {
            const resolved = path.resolve(file);
            const raw = fs.readFileSync(resolved, 'utf8');
            const json = JSON.parse(raw) as unknown;
            const ConfigSchema = z.object({
                name: z.string().min(1),
                instructions: z.string().min(1),
                model: z.string().optional(),
                maxSteps: z.number().int().positive().optional(),
                timeoutMs: z.number().int().positive().optional(),
            });
            parse(ConfigSchema, json, 'invalid agent configuration');
            console.log(`Valid config: ${resolved}`);
        });
}
