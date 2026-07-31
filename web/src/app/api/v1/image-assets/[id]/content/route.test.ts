import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { PRISMA_MOCK, REPOSITORY_FIND_MOCK, RESOLVE_STORAGE_MOCK } = vi.hoisted(() => ({
  PRISMA_MOCK: {
    imageAsset: { findFirst: vi.fn() },
    session: { findUnique: vi.fn() },
  },
  REPOSITORY_FIND_MOCK: vi.fn(),
  RESOLVE_STORAGE_MOCK: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: PRISMA_MOCK }));

vi.mock('@/lib/image-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/image-storage')>('@/lib/image-storage');
  return {
    ConfinedImageStorageError: actual.ConfinedImageStorageError,
    createConfinedImageReadStream: vi.fn(),
  };
});

vi.mock('@/lib/image-asset-storage-repository', () => ({
  ImageAssetStorageRepository: vi.fn().mockImplementation(() => ({
    findObjectReferenceByOwner: REPOSITORY_FIND_MOCK,
  })),
}));

vi.mock('@/lib/object-storage-alias-resolver', () => ({
  createObjectStorageAliasResolver: vi.fn(() => RESOLVE_STORAGE_MOCK),
}));

import { GET } from './route';
import { ConfinedImageStorageError, createConfinedImageReadStream } from '@/lib/image-storage';
import { ObjectStorageError } from '@/lib/object-storage-errors';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';

function request(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { headers } as unknown as Request;
}

function ctx(id: string = ASSET_ID) {
  return { params: Promise.resolve({ id }) };
}

function nodeReadable(content: string) {
  return Readable.from([Buffer.from(content)]);
}

const BASE_ASSET = {
  id: ASSET_ID,
  ownerUserId: OWNER_ID,
  deletedAt: null,
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 5,
  storagePath: '/storage/x/photo.jpg',
  storageBackend: null,
  storageBucketAlias: null,
  storageKey: null,
  storageVersionId: null,
  storageEtag: null,
  contentSha256: null,
  storageState: null,
};

describe('GET /api/v1/image-assets/[id]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PRISMA_MOCK.session.findUnique.mockResolvedValue({ user: { id: OWNER_ID } });
  });

  it('1. returns 401 when unauthenticated (no token)', async () => {
    const response = await GET(request(null) as never, ctx());
    expect(response.status).toBe(401);
    expect(PRISMA_MOCK.imageAsset.findFirst).not.toHaveBeenCalled();
  });

  it('2. returns 401 when the session token does not resolve to a user', async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValue(null);
    const response = await GET(request('bad-token') as never, ctx());
    expect(response.status).toBe(401);
  });

  it('3. returns 404 for an absent asset', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue(null);
    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(404);
  });

  it('4. treats another owner\'s asset identically to absent (owner-scoped query, never fetched)', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue(null);
    await GET(request('token') as never, ctx());
    expect(PRISMA_MOCK.imageAsset.findFirst).toHaveBeenCalledWith({
      where: { id: ASSET_ID, ownerUserId: OWNER_ID },
    });
  });

  it('5. returns 404 for a soft-deleted asset', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, deletedAt: new Date() });
    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(404);
  });

  it('6. legacy-local: streams bytes with safe headers', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg' });
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({
      stream: nodeReadable('hello') as never,
      sizeBytes: 5,
    });

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="photo.jpg"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Length')).toBe('5');
  });

  it('7. legacy-local: a "pending" (never-written) row is 409, never streamed', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: 'pending' });
    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(409);
    expect(createConfinedImageReadStream).not.toHaveBeenCalled();
  });

  it('8. legacy-local: unsafe path / symlink escape maps to sanitized 409, no path leak', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg' });
    vi.mocked(createConfinedImageReadStream).mockRejectedValue(new ConfinedImageStorageError());

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('/storage/x/photo.jpg');
  });

  it('9. legacy-local: unexpected read failure maps to sanitized 500', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg' });
    vi.mocked(createConfinedImageReadStream).mockRejectedValue(new Error('EACCES: permission denied, open /storage/x/photo.jpg'));

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('/storage/x/photo.jpg');
    expect(JSON.stringify(body)).not.toContain('EACCES');
  });

  it('10. object-backed: streams bytes using the exact persisted key and version, never "latest"', async () => {
    const storedGet = vi.fn().mockResolvedValue({
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
      etag: 'etag-1',
      contentSha256: 'a'.repeat(64),
      sizeBytes: 5,
      contentType: 'image/jpeg',
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('hello')); controller.close(); } }),
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({ get: storedGet });
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({
      ...BASE_ASSET,
      storageBackend: 's3',
      storageState: 'available',
    });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3',
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
      etag: 'etag-1',
      contentSha256: 'a'.repeat(64),
      sizeBytes: 5,
    });

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(200);
    expect(storedGet).toHaveBeenCalledWith({
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
    });
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="photo.jpg"');
  });

  it.each(['pending_upload', 'deleted', 'quarantined', null])(
    '11. object-backed: storageState=%s is not servable -> 409, never touches object storage',
    async (state) => {
      PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: state });
      const response = await GET(request('token') as never, ctx());
      expect(response.status).toBe(409);
      expect(REPOSITORY_FIND_MOCK).not.toHaveBeenCalled();
    }
  );

  it('12. object-backed: repository reports no reference -> 404', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue(null);
    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(404);
  });

  it('13. object-backed: an incomplete/missing-version reference fails closed at 409, never requests "latest"', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3',
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: null,
      etag: null,
      contentSha256: 'a'.repeat(64),
      sizeBytes: 5,
    });

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(409);
    expect(RESOLVE_STORAGE_MOCK).not.toHaveBeenCalled();
  });

  it('14. object-backed: missing object in the provider (not_found) maps to sanitized 500', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3', bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1', etag: 'etag-1', contentSha256: 'a'.repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({ get: vi.fn().mockRejectedValue(new ObjectStorageError('not_found')) });

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('The requested object was not found.');
  });

  it('15. object-backed: provider access-denied failure is sanitized (no bucket/key/credential detail)', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3', bucketAlias: 'super-secret-bucket',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1', etag: 'etag-1', contentSha256: 'a'.repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({ get: vi.fn().mockRejectedValue(new ObjectStorageError('access_denied')) });

    const response = await GET(request('token') as never, ctx());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('super-secret-bucket');
  });

  it('16. object-backed: unavailable resolver (no matching bucket alias) maps to sanitized 500', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3', bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1', etag: 'etag-1', contentSha256: 'a'.repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue(null);

    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(500);
  });

  it('17. no fallback between backends: legacy-local branch never calls the object storage resolver', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg' });
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable('hello') as never, sizeBytes: 5 });

    await GET(request('token') as never, ctx());

    expect(RESOLVE_STORAGE_MOCK).not.toHaveBeenCalled();
  });

  it('18. no fallback between backends: object-backed branch never calls the local confined reader', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 's3', storageState: 'available' });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: 's3', bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1', etag: 'etag-1', contentSha256: 'a'.repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        bucketAlias: 'primary-images', key: 'k', versionId: 'version-1', etag: 'etag-1',
        contentSha256: 'a'.repeat(64), sizeBytes: 5, contentType: 'image/jpeg',
        body: new ReadableStream({ start(c) { c.close(); } }),
      }),
    });

    await GET(request('token') as never, ctx());

    expect(createConfinedImageReadStream).not.toHaveBeenCalled();
  });

  it('19. an unrecognized storageBackend value fails closed at 409 (never crashes, never streams)', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: 'unexpected-value' });
    const response = await GET(request('token') as never, ctx());
    expect(response.status).toBe(409);
  });

  it('20. does not implement range/partial-content support (source-level check)', () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/Range|Content-Range|206/);
  });

  it('21. never exposes a provider URL or storage metadata header', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg' });
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable('hello') as never, sizeBytes: 5 });

    const response = await GET(request('token') as never, ctx());

    expect(response.headers.get('X-Storage-Backend')).toBeNull();
    expect(response.headers.get('X-Bucket')).toBeNull();
    expect(response.headers.get('X-Object-Key')).toBeNull();
  });

  it('22. sanitizes a filename containing quote characters before use in Content-Disposition', async () => {
    PRISMA_MOCK.imageAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: '/storage/x/photo.jpg', fileName: 'evil".jpg' });
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable('hello') as never, sizeBytes: 5 });

    const response = await GET(request('token') as never, ctx());

    expect(response.headers.get('Content-Disposition')).not.toContain('"evil"');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="evil.jpg"');
  });
});

function readSourceFile(): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'route.ts'), 'utf8');
}
