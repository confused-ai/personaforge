import { describe, it, expect } from 'vitest';
import { sqlToolkit, httpToolkit, fileToolkit, combineToolkits } from '../src/toolkits/index.js';

describe('sqlToolkit', () => {
  it('provides 3 tools + prompt fragment', () => {
    const kit = sqlToolkit({
      execute: async () => [{ a: 1 }],
      listTables: () => ['users', 'orders'],
      describeTable: () => [{ column: 'id', type: 'int' }],
    });
    expect(kit.tools).toHaveLength(3);
    expect(kit.tools.map((t) => t.name)).toEqual(['sql_list_tables', 'sql_describe_table', 'sql_query']);
    expect(kit.promptFragment).toContain('sql_list_tables');
  });

  it('sql_query blocks destructive statements', async () => {
    const kit = sqlToolkit({
      execute: async () => [],
      listTables: () => [],
      describeTable: () => [],
    });
    const query = kit.tools.find((t) => t.name === 'sql_query')!;
    await expect(query.execute({ query: 'DROP TABLE users' })).rejects.toThrow('destructive');
  });

  it('sql_list_tables returns list', async () => {
    const kit = sqlToolkit({
      execute: async () => [],
      listTables: () => ['t1'],
      describeTable: () => [],
    });
    const r = await kit.tools.find((t) => t.name === 'sql_list_tables')!.execute({});
    expect(r).toEqual({ tables: ['t1'] });
  });
});

describe('httpToolkit', () => {
  it('provides get + post tools', () => {
    const kit = httpToolkit();
    expect(kit.tools.map((t) => t.name)).toEqual(['http_get', 'http_post']);
  });

  it('enforces allowlist', async () => {
    const kit = httpToolkit({ allowlist: ['https://api.example.com'], fetchImpl: async () => new Response('ok') });
    const get = kit.tools.find((t) => t.name === 'http_get')!;
    await expect(get.execute({ url: 'https://evil.com/steal' })).rejects.toThrow('not in allowlist');
    expect((await get.execute({ url: 'https://api.example.com/data' })).status).toBe(200);
  });
});

describe('fileToolkit', () => {
  it('path guard prevents escape', async () => {
    const kit = fileToolkit({
      root: '/tmp/workspace',
      fs: {
        readFile: async () => 'data',
        writeFile: async () => {},
        readdir: async () => [],
      },
    });
    const read = kit.tools.find((t) => t.name === 'file_read')!;
    await expect(read.execute({ path: '../../../etc/passwd' })).rejects.toThrow('escapes root');
  });
});

describe('combineToolkits', () => {
  it('merges tools and fragments', () => {
    const a = sqlToolkit({ execute: async () => [], listTables: () => [], describeTable: () => [] });
    const b = httpToolkit();
    const combined = combineToolkits(a, b);
    expect(combined.tools.length).toBe(a.tools.length + b.tools.length);
    expect(combined.promptFragment).toContain('[sql]');
    expect(combined.promptFragment).toContain('[http]');
  });
  it('throws on duplicate tool names', () => {
    const a = httpToolkit();
    expect(() => combineToolkits(a, a)).toThrow('duplicate');
  });
});
