import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from '@/config/app-config.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES: Record<string, { ext: string; magic?: (buf: Buffer) => boolean }> = {
  'image/png': {
    ext: 'png',
    magic: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  'image/jpeg': {
    ext: 'jpg',
    magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/webp': {
    ext: 'webp',
    magic: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  'application/pdf': {
    ext: 'pdf',
    magic: (b) => b.length >= 4 && b.toString('ascii', 0, 4) === '%PDF',
  },
  'application/zip': {
    ext: 'zip',
    magic: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05),
  },
  'text/plain': {
    ext: 'txt',
    magic: (b) => !b.subarray(0, 512).includes(0x00),
  },
};

const SAFE_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf|zip|txt)$/;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly ids: IdFactory,
  ) {}

  private getBaseDir(): string {
    return this.config.uploadDir?.trim() || path.join(process.cwd(), 'uploads');
  }

  async saveUploadedFile(input: {
    fileName: string;
    mimeType?: string;
    dataBase64: string;
  }): Promise<{ id: string; storedName: string; originalName: string; mimeType: string; size: number; url: string }> {
    let rawMime = input.mimeType?.trim().toLowerCase() ?? '';
    let base64 = input.dataBase64.trim();

    const dataUrlMatch = base64.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/is);
    if (dataUrlMatch) {
      if (!rawMime) rawMime = dataUrlMatch[1]!.toLowerCase();
      base64 = dataUrlMatch[2]!;
    }

    if (rawMime === 'application/x-zip-compressed') {
      rawMime = 'application/zip';
    }
    const spec = ALLOWED_TYPES[rawMime];
    if (!spec) {
      throw new DomainError(
        'FILE_TYPE_NOT_ALLOWED',
        'Ruxsat etilgan fayl turlari: PNG, JPG, WEBP, PDF, ZIP, TXT',
      );
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) {
      throw new DomainError('FILE_TOO_SMALL', "Bo'sh fayl yuklab bo'lmaydi");
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new DomainError('FILE_TOO_LARGE', 'Fayl hajmi 5 MB dan oshmasligi kerak');
    }
    if (spec.magic && !spec.magic(buffer)) {
      throw new DomainError('MIME_TYPE_MISMATCH', 'Fayl tarkibi ko‘rsatilgan formatga mos kelmadi');
    }

    const id = this.ids.next();
    const storedName = `${id}.${spec.ext}`;
    const dir = this.getBaseDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storedName), buffer);

    const safeOriginal = path.basename(input.fileName).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || storedName;
    this.logger.debug(`Saved upload ${storedName} (${buffer.length} bytes)`);

    return {
      id,
      storedName,
      originalName: safeOriginal,
      mimeType: rawMime,
      size: buffer.length,
      url: `/api/v1/uploads/${storedName}`,
    };
  }

  async readUploadedFile(storedName: string): Promise<{ buffer: Buffer; mimeType: string; inline: boolean }> {
    if (!SAFE_FILENAME_RE.test(storedName)) {
      throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
    }
    const filePath = path.join(this.getBaseDir(), storedName);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
    }

    const ext = storedName.split('.').pop() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
      pdf: 'application/pdf',
      zip: 'application/zip',
      txt: 'text/plain; charset=utf-8',
    };
    const inline = ext === 'png' || ext === 'jpg' || ext === 'webp';
    return { buffer, mimeType: mimeMap[ext] ?? 'application/octet-stream', inline };
  }
}
