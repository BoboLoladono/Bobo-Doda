import { DomainError } from '@/common/errors/domain-error';

export const MIN_KYC_FILE_SIZE = 100; // bytes
export const MAX_KYC_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export function detectMimeTypeFromMagicBytes(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length < 4) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  // WebP: 52 49 46 46 (RIFF) .... 57 45 42 50 (WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function validateDocumentFile(buffer: Buffer, claimedMimeType?: string): AllowedMimeType {
  if (buffer.length < MIN_KYC_FILE_SIZE) {
    throw new DomainError('FILE_TOO_SMALL', `Hujjat fayli juda kichik (kamida ${MIN_KYC_FILE_SIZE} bayt bo‘lishi kerak)`);
  }
  if (buffer.length > MAX_KYC_FILE_SIZE) {
    throw new DomainError('FILE_TOO_LARGE', `Hujjat fayli 10MB dan oshmasligi kerak`);
  }

  const detected = detectMimeTypeFromMagicBytes(buffer);
  if (!detected) {
    throw new DomainError(
      'INVALID_FILE_TYPE',
      'Faqat JPEG, PNG, WebP yoki PDF formatidagi haqiqiy hujjatlar qabul qilinadi',
    );
  }

  if (claimedMimeType && claimedMimeType !== detected) {
    // If client claimed JPEG but magic bytes are PNG or PDF, reject spoofed header
    throw new DomainError(
      'MIME_TYPE_MISMATCH',
      `Faylning haqiqiy formati (${detected}) berilgan formatga (${claimedMimeType}) mos kelmadi`,
    );
  }

  return detected;
}

export function parseBase64Document(raw: string): { buffer: Buffer; mimeType: AllowedMimeType } {
  let mimeHint: string | undefined;
  let base64Data = raw.trim();

  // Handle data URLs: data:image/jpeg;base64,...
  const match = /^data:([^;]+);base64,(.+)$/.exec(base64Data);
  if (match && match[2]) {
    mimeHint = match[1];
    base64Data = match[2];
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const verifiedMime = validateDocumentFile(buffer, mimeHint);
  return { buffer, mimeType: verifiedMime };
}
