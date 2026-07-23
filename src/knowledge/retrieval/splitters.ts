/**
 * @personaforge/knowledge — text splitters.
 *
 * Zero-dependency chunking for RAG ingestion. Closes the biggest LangChain
 * retrieval gap: turning raw documents into overlapping, size-bounded chunks
 * before embedding.
 *
 * All splitters return `Chunk[]` carrying the source metadata plus a running
 * `chunkIndex` so downstream retrievers can reassemble or cite by position.
 *
 * ```ts
 * const splitter = new RecursiveCharacterSplitter({ chunkSize: 800, chunkOverlap: 100 });
 * const chunks = splitter.splitText(longDoc);
 * ```
 */

/** One produced chunk of text. */
export interface Chunk {
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  /** 0-based position of this chunk within its source document. */
  readonly chunkIndex: number;
}

/** Common splitter options. */
export interface SplitterOptions {
  /** Target maximum characters per chunk. Default 1000. */
  chunkSize?: number;
  /** Characters shared between adjacent chunks for context continuity. Default 200. */
  chunkOverlap?: number;
  /** Measure length by this function instead of `.length` (e.g. a token counter). */
  lengthFn?: (text: string) => number;
}

/** A splitter turns text into bounded chunks. */
export interface TextSplitter {
  splitText(text: string, metadata?: Record<string, unknown>): Chunk[];
  /** Split many documents, preserving each document's metadata. */
  splitDocuments(docs: Array<{ content: string; metadata?: Record<string, unknown> }>): Chunk[];
}

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 200;

abstract class BaseSplitter implements TextSplitter {
  protected readonly chunkSize: number;
  protected readonly chunkOverlap: number;
  protected readonly len: (t: string) => number;

  constructor(opts: SplitterOptions = {}) {
    this.chunkSize = opts.chunkSize ?? DEFAULT_SIZE;
    this.chunkOverlap = opts.chunkOverlap ?? DEFAULT_OVERLAP;
    this.len = opts.lengthFn ?? ((t) => t.length);
    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error('[TextSplitter] chunkOverlap must be smaller than chunkSize.');
    }
  }

  abstract splitText(text: string, metadata?: Record<string, unknown>): Chunk[];

  splitDocuments(docs: Array<{ content: string; metadata?: Record<string, unknown> }>): Chunk[] {
    const out: Chunk[] = [];
    for (const doc of docs) out.push(...this.splitText(doc.content, doc.metadata));
    return out;
  }

  /**
   * Merge small pieces into chunks up to `chunkSize`, carrying `chunkOverlap`
   * worth of trailing pieces into the next chunk. Shared by every splitter.
   */
  protected mergePieces(pieces: string[], joiner: string, metadata: Record<string, unknown>): Chunk[] {
    const chunks: Chunk[] = [];
    let current: string[] = [];
    let currentLen = 0;
    let index = 0;

    const flush = (): void => {
      if (current.length === 0) return;
      const content = current.join(joiner).trim();
      if (content.length > 0) {
        chunks.push({ content, metadata: { ...metadata }, chunkIndex: index++ });
      }
    };

    for (const piece of pieces) {
      const pieceLen = this.len(piece);
      if (currentLen + pieceLen > this.chunkSize && current.length > 0) {
        flush();
        // Carry overlap: keep trailing pieces whose combined length <= overlap.
        const carried: string[] = [];
        let carriedLen = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          const l = this.len(current[i] ?? '');
          if (carriedLen + l > this.chunkOverlap) break;
          carried.unshift(current[i] ?? '');
          carriedLen += l;
        }
        current = carried;
        currentLen = carriedLen;
      }
      current.push(piece);
      currentLen += pieceLen;
    }
    flush();
    return chunks;
  }
}

/**
 * RecursiveCharacterSplitter — LangChain's default. Tries a priority list of
 * separators (paragraph → line → sentence → word → char) and recurses into any
 * fragment still larger than `chunkSize`, so semantic boundaries are preferred.
 */
export class RecursiveCharacterSplitter extends BaseSplitter {
  private readonly separators: string[];

  constructor(opts: SplitterOptions & { separators?: string[] } = {}) {
    super(opts);
    this.separators = opts.separators ?? ['\n\n', '\n', '. ', ' ', ''];
  }

  splitText(text: string, metadata: Record<string, unknown> = {}): Chunk[] {
    const pieces = this.recurse(text, this.separators);
    return this.mergePieces(pieces, '', metadata);
  }

  private recurse(text: string, separators: string[]): string[] {
    if (this.len(text) <= this.chunkSize) return text.length > 0 ? [text] : [];
    const [sep, ...rest] = separators;
    if (sep === undefined) return [text]; // no separators left; return as-is
    const parts = sep === '' ? text.split('') : text.split(sep);
    const out: string[] = [];
    for (const part of parts) {
      const withSep = sep === '' ? part : part + sep;
      if (this.len(withSep) <= this.chunkSize) {
        if (withSep.length > 0) out.push(withSep);
      } else {
        out.push(...this.recurse(part, rest));
      }
    }
    return out;
  }
}

/**
 * MarkdownSplitter — splits on heading boundaries first so a chunk keeps its
 * section heading as context, then falls back to recursive character splitting
 * within oversized sections.
 */
export class MarkdownSplitter extends BaseSplitter {
  splitText(text: string, metadata: Record<string, unknown> = {}): Chunk[] {
    const lines = text.split('\n');
    const sections: Array<{ heading: string; body: string[] }> = [];
    let currentHeading = '';
    let body: string[] = [];

    const push = (): void => {
      if (body.length > 0 || currentHeading) sections.push({ heading: currentHeading, body });
    };

    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        push();
        currentHeading = line.trim();
        body = [];
      } else {
        body.push(line);
      }
    }
    push();

    const inner = new RecursiveCharacterSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      lengthFn: this.len,
    });

    const chunks: Chunk[] = [];
    let index = 0;
    for (const section of sections) {
      const prefix = section.heading ? section.heading + '\n' : '';
      const content = prefix + section.body.join('\n');
      if (content.trim().length === 0) continue;
      if (this.len(content) <= this.chunkSize) {
        chunks.push({ content: content.trim(), metadata: { ...metadata, heading: section.heading }, chunkIndex: index++ });
      } else {
        for (const sub of inner.splitText(section.body.join('\n'), { ...metadata, heading: section.heading })) {
          // Re-inject heading so every sub-chunk keeps its section context.
          chunks.push({ content: (prefix + sub.content).trim(), metadata: sub.metadata, chunkIndex: index++ });
        }
      }
    }
    return chunks;
  }
}

/**
 * SemanticSplitter — groups adjacent sentences while their embedding stays
 * similar, cutting a new chunk when similarity drops below `breakThreshold`.
 * Requires an embedding function; without one, prefer RecursiveCharacterSplitter.
 */
export class SemanticSplitter implements TextSplitter {
  private readonly embed: (text: string) => Promise<number[]>;
  private readonly breakThreshold: number;
  private readonly maxChars: number;

  constructor(opts: {
    embed: (text: string) => Promise<number[]>;
    /** Cosine-similarity floor below which a new chunk starts. Default 0.5. */
    breakThreshold?: number;
    /** Hard character cap so a single semantic run cannot exceed the window. Default 2000. */
    maxChars?: number;
  }) {
    this.embed = opts.embed;
    this.breakThreshold = opts.breakThreshold ?? 0.5;
    this.maxChars = opts.maxChars ?? 2000;
  }

  // Synchronous interface throws — semantic grouping needs async embeddings.
  splitText(): Chunk[] {
    throw new Error('[SemanticSplitter] Use splitTextAsync() — embeddings are asynchronous.');
  }

  splitDocuments(): Chunk[] {
    throw new Error('[SemanticSplitter] Use splitDocumentsAsync() — embeddings are asynchronous.');
  }

  async splitTextAsync(text: string, metadata: Record<string, unknown> = {}): Promise<Chunk[]> {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length === 0) return [];
    const vectors = await Promise.all(sentences.map((s) => this.embed(s)));

    const chunks: Chunk[] = [];
    let group: string[] = [sentences[0] ?? ''];
    let groupLen = (sentences[0] ?? '').length;
    let index = 0;

    for (let i = 1; i < sentences.length; i++) {
      const sim = cosine(vectors[i - 1] ?? [], vectors[i] ?? []);
      const sentence = sentences[i] ?? '';
      if (sim < this.breakThreshold || groupLen + sentence.length > this.maxChars) {
        chunks.push({ content: group.join(' '), metadata: { ...metadata }, chunkIndex: index++ });
        group = [sentence];
        groupLen = sentence.length;
      } else {
        group.push(sentence);
        groupLen += sentence.length + 1;
      }
    }
    if (group.length > 0) chunks.push({ content: group.join(' '), metadata: { ...metadata }, chunkIndex: index++ });
    return chunks;
  }

  async splitDocumentsAsync(docs: Array<{ content: string; metadata?: Record<string, unknown> }>): Promise<Chunk[]> {
    const out: Chunk[] = [];
    for (const doc of docs) out.push(...(await this.splitTextAsync(doc.content, doc.metadata)));
    return out;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    ma += x * x;
    mb += y * y;
  }
  if (ma === 0 || mb === 0) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}
