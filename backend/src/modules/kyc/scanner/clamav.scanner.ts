import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';
import type { MalwareScanner, ScanResult } from './malware-scanner.interface';

@Injectable()
export class ClamAvScanner implements MalwareScanner {
  private readonly logger = new Logger(ClamAvScanner.name);
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(host = process.env.CLAMAV_HOST || '127.0.0.1', port = Number(process.env.CLAMAV_PORT || 3310), timeoutMs = 10000) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  async scan(buffer: Buffer, filename: string): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = new net.Socket();
      let response = '';

      socket.setTimeout(this.timeoutMs);

      socket.connect(this.port, this.host, () => {
        // ClamAV INSTREAM protocol: 'zINSTREAM\0'
        socket.write('zINSTREAM\0');

        const chunkSize = 2048;
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
          const sizeBuffer = Buffer.alloc(4);
          sizeBuffer.writeUInt32BE(chunk.length, 0);
          socket.write(sizeBuffer);
          socket.write(chunk);
        }

        // End of stream marker (size 0)
        const endMarker = Buffer.alloc(4, 0);
        socket.write(endMarker);
      });

      socket.on('data', (data) => {
        response += data.toString('utf8');
      });

      socket.on('end', () => {
        const trimmed = response.trim();
        if (trimmed.includes('OK')) {
          resolve({ clean: true, scannedAt: new Date(), scanner: 'clamav-daemon' });
        } else if (trimmed.includes('FOUND')) {
          const match = /stream:\s*(.+)\s*FOUND/.exec(trimmed);
          const threat = match ? match[1] : 'Infected';
          resolve({ clean: false, threat, scannedAt: new Date(), scanner: 'clamav-daemon' });
        } else {
          reject(new Error(`Unexpected ClamAV daemon response: ${trimmed}`));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`ClamAV scan timed out after ${this.timeoutMs}ms for ${filename}`));
      });

      socket.on('error', (err) => {
        this.logger.warn(`ClamAV connection error for ${filename}: ${err.message}`);
        reject(new Error(`ClamAV scanner connection failed: ${err.message}`));
      });
    });
  }
}
