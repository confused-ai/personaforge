import { describe, it, expect } from 'vitest';

import { redactPII, redactSecrets, combineRedactors } from '../src/graph/run-recorder.js';

describe('free-text PII redaction', () => {
  it('scrubs email, SSN, JWT, and card-like digits from string values', () => {
    const out = redactPII({
      prompt: 'email bob@acme.com ssn 123-45-6789 card 4111111111111111 tok eyJhbGc.aBc_1.dEf-2',
    }) as any;
    expect(out.prompt).toContain('[EMAIL]');
    expect(out.prompt).toContain('[SSN]');
    expect(out.prompt).toContain('[CARD]');
    expect(out.prompt).toContain('[JWT]');
    expect(out.prompt).not.toContain('bob@acme.com');
    expect(out.prompt).not.toContain('123-45-6789');
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactPII({ items: [{ note: 'reach me at a@b.co' }] }) as any;
    expect(out.items[0].note).toContain('[EMAIL]');
  });

  it('combines with key-based secret redaction', () => {
    const redact = combineRedactors(redactSecrets, redactPII);
    const out = redact({ password: 'hunter2', note: 'contact a@b.co' }) as any;
    expect(out.password).toBe('[REDACTED]');
    expect(out.note).toContain('[EMAIL]');
  });
});
