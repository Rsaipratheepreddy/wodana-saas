import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';

const version = 1;
const nonceBytes = 24;

export function sealOfflineBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  context: string,
) {
  if (key.length !== 32 || nonce.length !== nonceBytes)
    throw new Error('Offline protection key material is invalid.');
  const ciphertext = xchacha20poly1305(key, nonce, utf8ToBytes(context)).encrypt(plaintext);
  const sealed = new Uint8Array(1 + nonce.length + ciphertext.length);
  sealed[0] = version;
  sealed.set(nonce, 1);
  sealed.set(ciphertext, 1 + nonce.length);
  return sealed;
}

export function openOfflineBytes(sealed: Uint8Array, key: Uint8Array, context: string) {
  if (sealed.length <= 1 + nonceBytes || sealed[0] !== version)
    throw new Error('The protected offline draft is invalid.');
  const nonce = sealed.slice(1, 1 + nonceBytes);
  const ciphertext = sealed.slice(1 + nonceBytes);
  try {
    return xchacha20poly1305(key, nonce, utf8ToBytes(context)).decrypt(ciphertext);
  } catch {
    throw new Error('The protected offline draft could not be verified.');
  }
}

export const sealOfflineText = (value: string, key: Uint8Array, nonce: Uint8Array, context: string) =>
  `wd1:${bytesToHex(sealOfflineBytes(utf8ToBytes(value), key, nonce, context))}`;

export function openOfflineText(value: string, key: Uint8Array, context: string) {
  if (!value.startsWith('wd1:')) throw new Error('The protected offline draft is invalid.');
  return bytesToUtf8(openOfflineBytes(hexToBytes(value.slice(4)), key, context));
}

export const OFFLINE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const isOfflineDraftExpired = (createdAt: number, now = Date.now()) =>
  !Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > OFFLINE_DRAFT_TTL_MS;
