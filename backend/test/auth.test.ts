import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/auth.js';

describe('password hashing', () => {
  it('accepts the right password and rejects others, case sensitively', async () => {
    const hash = await hashPassword('JoinWick');
    expect(await verifyPassword('JoinWick', hash)).toBe(true);
    expect(await verifyPassword('joinwick', hash)).toBe(false);
    expect(await verifyPassword('Join Wick', hash)).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored values', async () => {
    expect(await verifyPassword('x', 'plain')).toBe(false);
  });
});
