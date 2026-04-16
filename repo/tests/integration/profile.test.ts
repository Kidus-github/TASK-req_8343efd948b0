import { describe, expect, it } from 'vitest';
import {
  createProfile,
  getProfile,
  hasProfile,
  resetDeviceProfile,
  verifyPassphrase
} from '../../src/lib/services/profile';

describe('profile service', () => {
  it('creates, verifies, and resets a profile', async () => {
    const create = await createProfile('Nova', 'correct-horse-9');
    expect(create.ok).toBe(true);
    expect(await hasProfile()).toBe(true);

    const prof = await getProfile();
    expect(prof?.username).toBe('Nova');
    expect(prof?.passphraseHashLocal).not.toBe('correct-horse-9'); // never raw

    const verifyOk = await verifyPassphrase('correct-horse-9');
    expect(verifyOk.ok).toBe(true);
    const verifyFail = await verifyPassphrase('wrong-passphrase-1');
    expect(verifyFail.ok).toBe(false);

    const reset = await resetDeviceProfile();
    expect(reset.ok).toBe(true);
    expect(await hasProfile()).toBe(false);
  });

  it('rejects weak profiles', async () => {
    const a = await createProfile('', 'abc12345');
    expect(a.ok).toBe(false);
    const b = await createProfile('x', 'abc');
    expect(b.ok).toBe(false);
    const c = await createProfile('x', 'abcdefghi'); // no digit
    expect(c.ok).toBe(false);
  });

  it('rejects a second profile on the same device', async () => {
    await createProfile('One', 'abc12345');
    const r = await createProfile('Two', 'abc12345');
    expect(r.ok).toBe(false);
  });
});
