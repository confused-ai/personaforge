import { describe, it, expect } from 'vitest';
import { loadMarkdownText } from '../src/knowledge/loaders/markdown-loader.js';
import { loadHtmlText } from '../src/knowledge/loaders/html-loader.js';

describe('loadMarkdownText', () => {
  it('splits into per-section docs with headings', () => {
    const md = '# Title\nintro text\n## Section A\nbody a\n## Section B\nbody b';
    const docs = loadMarkdownText(md, { source: 'test.md' });
    expect(docs.length).toBe(3);
    expect(docs[0]!.content).toContain('# Title');
    expect(docs[1]!.metadata.heading).toBe('## Section A');
    expect(docs[1]!.content).toContain('body a');
  });
  it('attaches metadata', () => {
    const docs = loadMarkdownText('# H\nx', { metadata: { tag: 'foo' } });
    expect(docs[0]!.metadata.tag).toBe('foo');
  });
});

describe('loadHtmlText', () => {
  it('strips tags, scripts, styles', () => {
    const html = '<html><head><style>.x{}</style></head><body><script>evil()</script><p>Hello &amp; welcome</p></body></html>';
    const doc = loadHtmlText(html, { source: 'x.html' });
    expect(doc.content).toBe('Hello & welcome');
    expect(doc.content).not.toContain('evil');
    expect(doc.metadata.source).toBe('x.html');
  });
});
