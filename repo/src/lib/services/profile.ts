import type { DeviceProfile, Result, UiRole } from '../types';
import { all, clearAll, get, put } from '../db/indexeddb';
import { hashPassphrase, randomSaltHex } from '../util/hash';
import { newId, nowIso } from '../util/ids';
import { ErrorCodes, fail, ok } from '../util/errors';
import { validatePassphrase, validateUsername } from '../util/validators';
import { resetPrefs, savePrefs, loadPrefs } from '../db/prefs';
import { logAudit } from './audit';

const PROFILE_STORE = 'deviceProfile';

export async function getProfile(): Promise<DeviceProfile | null> {
  const list = await all<DeviceProfile>(PROFILE_STORE);
  return list[0] ?? null;
}

export async function hasProfile(): Promise<boolean> {
  return (await getProfile()) !== null;
}

export async function createProfile(
  username: string,
  passphrase: string,
  uiRole: UiRole = 'editor'
): Promise<Result<DeviceProfile>> {
  const existing = await getProfile();
  if (existing) {
    return fail(ErrorCodes.PROFILE_INVALID, 'A local profile already exists on this device.');
  }
  const u = validateUsername(username);
  if (u) return fail(u.code, u.message);
  const p = validatePassphrase(passphrase);
  if (p) return fail(p.code, p.message);

  const salt = randomSaltHex(16);
  const hash = await hashPassphrase(passphrase, salt);
  const profile: DeviceProfile = {
    id: newId('profile'),
    username: username.trim(),
    passphraseHashLocal: hash,
    passphraseSalt: salt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    uiRole,
    theme: 'light',
    defaultPlaybackSpeed: 1.0,
    quietHours: { start: '22:00', end: '06:00', allowHeavyJobs: false }
  };
  await put(PROFILE_STORE, profile);
  const prefs = loadPrefs();
  savePrefs({ ...prefs, uiRole });
  await logAudit('profile', profile.id, 'create');
  return ok(profile);
}

export async function verifyPassphrase(passphrase: string): Promise<Result<boolean>> {
  const profile = await getProfile();
  if (!profile) return fail(ErrorCodes.PROFILE_NOT_FOUND, 'No local profile.');
  const candidate = await hashPassphrase(passphrase, profile.passphraseSalt);
  if (candidate !== profile.passphraseHashLocal) {
    return fail(ErrorCodes.PROFILE_PASSPHRASE_MISMATCH, 'Passphrase does not match.');
  }
  return ok(true);
}

export async function updateProfile(
  patch: Partial<Omit<DeviceProfile, 'id' | 'passphraseHashLocal' | 'passphraseSalt' | 'createdAt'>>
): Promise<Result<DeviceProfile>> {
  const profile = await getProfile();
  if (!profile) return fail(ErrorCodes.PROFILE_NOT_FOUND, 'No local profile.');
  const updated: DeviceProfile = { ...profile, ...patch, updatedAt: nowIso() };
  await put(PROFILE_STORE, updated);
  await logAudit('profile', updated.id, 'update', 'user', { patch });
  return ok(updated);
}

/**
 * Reset all local device data. Irreversibly wipes IndexedDB, LocalStorage
 * preferences, and any cached blobs. The caller must confirm before invoking.
 */
export async function resetDeviceProfile(): Promise<Result<true>> {
  const profile = await getProfile();
  if (profile) await logAudit('profile', profile.id, 'reset');
  await clearAll();
  resetPrefs();
  return ok(true);
}
