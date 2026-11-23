import { describe, expect, it } from 'vitest';
import { hashPassword, randomId, sha256Hex, verifyPassword } from '../worker/crypto';

describe('worker/crypto', () => {
  it('hashes and verifies passwords with PBKDF2', async () => {
    const hash = await hashPassword('S3cur3-Pass!');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('S3cur3-Pass!', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('computes deterministic SHA-256 hex', async () => {
    const h = await sha256Hex('fx-studio');
    expect(h).toHaveLength(64);
    expect(h).toBe(await sha256Hex('fx-studio'));
  });

  it('generates prefixed random IDs', () => {
    const a = randomId('prj');
    const b = randomId('prj');
    expect(a.startsWith('prj_')).toBe(true);
    expect(a).not.toBe(b);
  });
});
