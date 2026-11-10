export interface StoredObject {
  buffer: Buffer;
  contentType: string;
  contentLength: number;
}

export interface StorageProvider {
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<StoredObject>;
  deleteObject(key: string): Promise<void>;
  createSignedDownloadToken(key: string, expiresInSeconds: number): string;
  verifySignedDownloadToken(token: string): { key: string; valid: boolean };
}
