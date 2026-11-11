import {
  detectMimeTypeFromMagicBytes,
  parseBase64Document,
  validateDocumentFile,
} from './file-magic-bytes.util';

describe('KYC File Validation & Magic Bytes', () => {
  // Sample valid magic byte buffers
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(150).fill(0x01)]);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(150).fill(0x02)]);
  const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, ...Array(150).fill(0x03)]);
  const webpHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ...Array(150).fill(0x04),
  ]);

  it('detects correct MIME types from real magic bytes', () => {
    expect(detectMimeTypeFromMagicBytes(jpegHeader)).toBe('image/jpeg');
    expect(detectMimeTypeFromMagicBytes(pngHeader)).toBe('image/png');
    expect(detectMimeTypeFromMagicBytes(pdfHeader)).toBe('application/pdf');
    expect(detectMimeTypeFromMagicBytes(webpHeader)).toBe('image/webp');
  });

  it('rejects executable and non-allowed file magic bytes', () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, ...Array(150).fill(0x00)]); // MZ
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Array(150).fill(0x00)]); // ELF
    const htmlBuffer = Buffer.from('<html><body>Hello</body></html>');

    expect(detectMimeTypeFromMagicBytes(exeBuffer)).toBeNull();
    expect(detectMimeTypeFromMagicBytes(elfBuffer)).toBeNull();
    expect(detectMimeTypeFromMagicBytes(htmlBuffer)).toBeNull();
  });

  it('rejects files smaller than 100 bytes', () => {
    const tinyBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => validateDocumentFile(tinyBuffer)).toThrow();
  });

  it('rejects files larger than 10MB', () => {
    const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
    hugeBuffer[0] = 0xff;
    hugeBuffer[1] = 0xd8;
    hugeBuffer[2] = 0xff;
    expect(() => validateDocumentFile(hugeBuffer)).toThrow();
  });

  it('detects and rejects spoofed MIME type headers', () => {
    // PNG bytes, but claimed to be JPEG
    expect(() => validateDocumentFile(pngHeader, 'image/jpeg')).toThrow();
  });

  it('parses valid base64 data URLs', () => {
    const dataUrl = `data:image/png;base64,${pngHeader.toString('base64')}`;
    const result = parseBase64Document(dataUrl);
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.length).toBe(pngHeader.length);
  });
});
