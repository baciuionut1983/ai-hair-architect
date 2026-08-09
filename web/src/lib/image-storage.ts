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

export type LocalImageDeleteOutcome = 'deleted' | 'already_absent';

// M36: confined, honest local-file delete for the retention purge job.
// Unlike deleteImageFile above (which silently swallows every error,
// including real ones like a permissions failure), this distinguishes
// "already gone" -- idempotent success, since the purge must be safely
// retryable -- from any other failure, which the caller must NOT treat as
// success (a purge must never hard-delete the DB row unless the real file
// was actually cleared or was already absent). Confined the same way
// createConfinedImageReadStream is: both a lexical prefix check and a
// realpath check, defeating a symlink pointing outside STORAGE_DIR.
export async function deleteConfinedImageFileForRetention(storagePath: string): Promise<LocalImageDeleteOutcome> {
  const resolvedRoot = path.resolve(STORAGE_DIR);
  const resolvedPath = path.resolve(storagePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new ConfinedImageStorageError();
  }

  let realPath: string;
  try {
    realPath = await fs.promises.realpath(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'already_absent';
    }
    throw new ConfinedImageStorageError();
  }

  const realRoot = await fs.promises.realpath(resolvedRoot);
  if (realPath !== realRoot && !realPath.startsWith(realRoot + path.sep)) {
    throw new ConfinedImageStorageError();
  }

  try {
    await fs.promises.unlink(realPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'already_absent';
    }
    throw error;
  }

  try {
    const dir = path.dirname(realPath);
    const files = await fs.promises.readdir(dir);
    if (files.length === 0) {
      await fs.promises.rmdir(dir);
    }
  } catch {
    // Best-effort empty-directory cleanup only -- the file itself was
    // already successfully deleted, so this never affects the outcome.
  }

  return 'deleted';
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
