/**
 * GitHub Repo Loader — fetches file tree from GitHub API, loads text files.
 */
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface GithubLoaderOptions {
  /** Owner/org. */
  owner: string;
  /** Repo name. */
  repo: string;
  /** Branch/ref. Default 'main'. */
  branch?: string;
  /** Path prefix filter. Default '' (root). */
  path?: string;
  /** File extensions to include. Default: common text extensions. */
  extensions?: string[];
  /** Max files. Default 200. */
  maxFiles?: number;
  /** GitHub token (for private repos or rate-limit). */
  token?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_EXT = ['.md', '.ts', '.js', '.py', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env'];

export async function loadGithubRepo(opts: GithubLoaderOptions): Promise<Document[]> {
  const branch = opts.branch ?? 'main';
  const exts = opts.extensions ?? DEFAULT_EXT;
  const maxFiles = opts.maxFiles ?? 200;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const treeUrl = `https://api.github.com/repos/${opts.owner}/${opts.repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(treeUrl, { headers });
  if (!res.ok) throw new Error(`[loadGithubRepo] HTTP ${String(res.status)}`);
  const json = (await res.json()) as { tree: Array<{ path: string; type: string }> };
  const files = json.tree
    .filter((e) => e.type === 'blob')
    .filter((e) => exts.some((ext) => e.path.endsWith(ext)))
    .filter((e) => !opts.path || e.path.startsWith(opts.path))
    .slice(0, maxFiles);

  const docs: Document[] = [];
  for (const file of files) {
    try {
      const raw = await fetch(`https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${branch}/${file.path}`, { headers });
      if (!raw.ok) continue;
      const content = await raw.text();
      docs.push({ id: randomUUID(), content, metadata: { ...opts.metadata, source: `${opts.owner}/${opts.repo}/${file.path}`, path: file.path } });
    } catch { /* skip */ }
  }
  return docs;
}
