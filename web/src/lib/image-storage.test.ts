import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfinedImageStorageError, createConfinedImageReadStream } from './image-storage';

const STORAGE_DIR = path.join(process.cwd(), '.storage', 'images');

function uniqueId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const createdPaths: string[] = [];

function trackedPath(...segments: string[]): string {
  const full = path.join(STORAGE_DIR, ...segments);
  createdPaths.push(full);
  return full;
}

afterEach(() => {
  for (const p of createdPaths.splice(0)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

describe('createConfinedImageReadStream', () => {
  it('1. streams the exact bytes of a file confined within the storage root', async () => {
    const dir = trackedPath(uniqueId());
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'photo.jpg');
    fs.writeFileSync(filePath, 'hello-bytes');

    const { stream, sizeBytes } = await createConfinedImageReadStream(filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe('hello-bytes');
    expect(sizeBytes).toBe(Buffer.byteLength('hello-bytes'));
  });

  it('2. rejects a path that lexically escapes the storage root via ..', async () => {
    const traversal = path.join(STORAGE_DIR, '..', '..', 'outside.jpg');
    await expect(createConfinedImageReadStream(traversal)).rejects.toBeInstanceOf(ConfinedImageStorageError);
  });

  it('3. rejects a non-existent path', async () => {
    const missing = trackedPath(uniqueId(), 'missing.jpg');
    await expect(createConfinedImageReadStream(missing)).rejects.toBeInstanceOf(ConfinedImageStorageError);
  });

  it('4. rejects a directory (requires a regular file)', async () => {
    const dir = trackedPath(uniqueId());
    fs.mkdirSync(dir, { recursive: true });
    await expect(createConfinedImageReadStream(dir)).rejects.toBeInstanceOf(ConfinedImageStorageError);
  });

  it('5. rejects a symlink that escapes the storage root, if the environment permits creating symlinks', async () => {
    const outsideTarget = path.join(os.tmpdir(), `symlink-target-${uniqueId()}.jpg`);
    fs.writeFileSync(outsideTarget, 'escaped-bytes');
    const dir = trackedPath(uniqueId());
    fs.mkdirSync(dir, { recursive: true });
    const linkPath = path.join(dir, 'link.jpg');

    try {
      fs.symlinkSync(outsideTarget, linkPath);
    } catch {
      // Symlink creation is not permitted in this environment (e.g. Windows
      // without Developer Mode/elevated privileges) -- skip, don't fail.
      fs.rmSync(outsideTarget, { force: true });
      return;
    }

    try {
      await expect(createConfinedImageReadStream(linkPath)).rejects.toBeInstanceOf(ConfinedImageStorageError);
    } finally {
      fs.rmSync(outsideTarget, { force: true });
    }
  });

  it('6. never leaks the resolved physical path in the thrown error', async () => {
    const missing = trackedPath(uniqueId(), 'missing.jpg');
    try {
      await createConfinedImageReadStream(missing);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as Error).message).not.toContain(missing);
      expect((error as Error).message).not.toContain(STORAGE_DIR);
    }
  });
});
