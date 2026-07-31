import fs from 'fs';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.storage', 'images');

export function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export function getStoragePath(userId: string, assetId: string, fileName: string): string {
  return path.join(STORAGE_DIR, userId, assetId, fileName);
}

export function getStorageDir(userId: string, assetId: string): string {
  return path.join(STORAGE_DIR, userId, assetId);
}

export async function saveImageFile(
  userId: string,
  assetId: string,
  fileName: string,
  buffer: Buffer
): Promise<string> {
  ensureStorageDir();
  const dir = getStorageDir(userId, assetId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = getStoragePath(userId, assetId, fileName);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

export async function readImageFile(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath);
}

export async function deleteImageFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
    const dir = path.dirname(filePath);
    const files = await fs.promises.readdir(dir);
    if (files.length === 0) {
      await fs.promises.rmdir(dir);
    }
  } catch {
    // already deleted or dir not empty
  }
}

export function getPrivateImageUrl(userId: string, assetId: string): string {
  return `/api/v1/image-assets/${assetId}/download`;
}

export class ConfinedImageStorageError extends Error {
  constructor() {
    super('Image storage path is not accessible.');
    this.name = 'ConfinedImageStorageError';
  }
}

export interface ConfinedImageReadStream {
  stream: fs.ReadStream;
  // The actual, freshly-stat()'d byte size of the file being streamed --
  // never the caller's own possibly-stale record of it.
  sizeBytes: number;
}

// Streams a legacy-local image file, confined to STORAGE_DIR by both lexical
// path comparison and realpath resolution (the latter defeats symlink escape,
// which lexical comparison alone cannot catch).
export async function createConfinedImageReadStream(storagePath: string): Promise<ConfinedImageReadStream> {
  const resolvedRoot = path.resolve(STORAGE_DIR);
  const resolvedPath = path.resolve(storagePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new ConfinedImageStorageError();
  }

  let realPath: string;
  try {
    realPath = await fs.promises.realpath(resolvedPath);
  } catch {
    throw new ConfinedImageStorageError();
  }

  const realRoot = await fs.promises.realpath(resolvedRoot);
  if (realPath !== realRoot && !realPath.startsWith(realRoot + path.sep)) {
    throw new ConfinedImageStorageError();
  }

  const stat = await fs.promises.stat(realPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new ConfinedImageStorageError();
  }

  return { stream: fs.createReadStream(realPath), sizeBytes: stat.size };
}
