import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const FORMAT_VERSION = 'v1';

function resolveKey(customKeyHex?: string): Buffer {
  const hex = customKeyHex || process.env.KYC_PII_ENCRYPTION_KEY;
  if (!hex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KYC_PII_ENCRYPTION_KEY must be configured in production (fail closed)');
    }
    return Buffer.from((process.env.STAFF_TOTP_ENCRYPTION_KEY || '22'.repeat(32)).padEnd(64, '0').slice(0, 64), 'hex');
  }
  const key = Buffer.from(hex.padEnd(64, '0').slice(0, 64), 'hex');
  return key;
}

export function encryptKycField(plainText: string, keyHex?: string): string {
  if (!plainText) return '';
  const key = resolveKey(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptKycField(encoded: string, keyHex?: string): string {
  if (!encoded) return '';
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('decryptKycField: invalid or unsupported ciphertext format');
  }
  const ivHex = parts[1];
  const authTagHex = parts[2];
  const ciphertextHex = parts[3];
  const key = resolveKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plain.toString('utf8');
}

export function hashIdentifier(identifier: string): string {
  if (!identifier) return '';
  const normalized = identifier.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

export function maskIdentifier(identifier?: string | null): string {
  if (!identifier) return '';
  const trimmed = identifier.trim();
  if (trimmed.length <= 4) return '***';
  const prefix = trimmed.slice(0, 2);
  const suffix = trimmed.slice(-2);
  const maskedLength = Math.max(trimmed.length - 4, 3);
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}
