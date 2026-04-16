// Shared passphrase-gate helper for sensitive local actions.
// Uses the in-app promptModal (no browser prompt()) and validates against
// the stored local passphrase hash.

import { verifyPassphrase } from '../services/profile';
import { promptModal } from '../stores/modal';
import { pushToast } from '../stores/toast';

export async function passphraseGate(purpose: string): Promise<boolean> {
  const value = await promptModal({
    title: 'Confirm your passphrase',
    message: `Re-enter your local passphrase to ${purpose}.`,
    inputType: 'password',
    placeholder: 'Your device passphrase',
    confirmLabel: 'Continue',
    validate: (v) => (v.trim().length === 0 ? 'Passphrase is required.' : null)
  });
  if (value === null) return false;
  const res = await verifyPassphrase(value);
  if (!res.ok) {
    pushToast('error', 'Passphrase does not match.');
    return false;
  }
  return true;
}
