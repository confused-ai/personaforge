/**
 * S3 Loader — loads text objects from an S3 bucket.
 * Requires @aws-sdk/client-s3 as optional peer dep.
 */
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface S3LoaderOptions {
  bucket: string;
  prefix?: string;
  /** Max objects to load. Default 100. */
  maxObjects?: number;
  region?: string;
  metadata?: Record<string, unknown>;
}

export async function loadS3(opts: S3LoaderOptions): Promise<Document[]> {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3' as unknown as string) as {
    S3Client: new (cfg: { region?: string }) => { send(cmd: unknown): Promise<unknown> };
    ListObjectsV2Command: new (opts: { Bucket: string; Prefix?: string; MaxKeys?: number }) => unknown;
    GetObjectCommand: new (opts: { Bucket: string; Key: string }) => unknown;
  };
  const s3 = new S3Client({ region: opts.region ?? 'us-east-1' });
  const list = (await s3.send(new ListObjectsV2Command({
    Bucket: opts.bucket,
    Prefix: opts.prefix,
    MaxKeys: opts.maxObjects ?? 100,
  }))) as { Contents?: Array<{ Key?: string }> };
  const keys = (list.Contents ?? []).map((o) => o.Key).filter(Boolean) as string[];
  const docs: Document[] = [];
  for (const key of keys) {
    try {
      const obj = (await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }))) as { Body?: { transformToString(): Promise<string> } };
      const content = await obj.Body?.transformToString();
      if (content) docs.push({ id: randomUUID(), content, metadata: { ...opts.metadata, source: `s3://${opts.bucket}/${key}`, key } });
    } catch { /* skip */ }
  }
  return docs;
}
