// Local hash utilities. Used for:
//  - the "convenience gate" passphrase (never a security boundary)
//  - snapshot checksums
//  - artifact checksums
//
// IMPORTANT: the PRD is explicit that this is NOT real authentication.

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(buf);
  }
  // Deterministic non-crypto fallback (FNV-1a 32 bit, expanded to 32 bytes).
  // Only used if subtle is not available; not a security claim.
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (h >>> ((i % 4) * 8)) & 0xff;
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? strToBytes(input) : input;
  const digest = await sha256Bytes(bytes);
  return bytesToHex(digest);
}

export function randomSaltHex(bytes: number = 16): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(arr);
}

export async function hashPassphrase(pass: string, salt: string): Promise<string> {
  // Local, salted, single-round SHA-256. Convenience only.
  return sha256Hex(`${salt}:${pass}`);
}
