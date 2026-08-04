import { createHash } from 'crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { PRISMA_MOCK, RESOLVE_STORAGE_MOCK } = vi.hoisted(() => ({
  PRISMA_MOCK: {
    imageAsset: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    imageAnalysis: {
      create: vi.fn(),
    },
  },
  RESOLVE_STORAGE_MOCK: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: PRISMA_MOCK }));

vi.mock('@/lib/image-upload-validation', () => ({
  validateUploadBatch: vi.fn(() => null),
  validateMagicBytes: vi.fn(async () => true),
  sanitizeFileName: vi.fn((name: string) => name.replace(/[^a-z0-9._-]/gi, '_')),
}));

vi.mock('@/lib/image-storage', () => ({
  saveImageFile: vi.fn(async (userId: string, assetId: string) => `/storage/${userId}/${assetId}/photo.jpg`),
}));

vi.mock('@/lib/image-normalizer', () => ({
  processImageForStorage: vi.fn(async (buffer: Buffer) => ({
    buffer,
    exifStripped: true,
    orientation: 1,
  })),
}));

vi.mock('@/lib/object-storage-alias-resolver', () => ({
  createObjectStorageAliasResolver: vi.fn(() => RESOLVE_STORAGE_MOCK),
}));

vi.mock('@/lib/object-storage-config', () => ({
  loadObjectStorageConfig: vi.fn(),
  validateObjectStorageWriteMode: vi.fn(),
}));

import { uploadAndAnalyzeImages } from './image-analysis-service';
import { saveImageFile } from '@/lib/image-storage';
import { loadObjectStorageConfig, validateObjectStorageWriteMode } from '@/lib/object-storage-config';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';

function fakeFile(name: string, type: string, content: string): File {
  const bytes = Buffer.from(content);
  return {
    name,
    type,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

const S3_CONFIG = {
  backend: 's3' as const,
  bucketAlias: 'primary-images',
  bucket: 'bucket',
  region: 'us-east-1',
  forcePathStyle: false,
  serverSideEncryption: 'AES256' as const,
  prefix: 'v1',
  requestTimeoutMs: 10_000,
};

function fakeStorage(overrides: Partial<{ put: unknown; head: unknown }> = {}) {
  return {
    put: overrides.put ?? vi.fn(async ({ contentSha256 }: { contentSha256: string }) => ({
      backend: 's3',
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
      etag: 'etag-1',
      contentSha256,
      sizeBytes: 5,
    })),
    head: overrides.head ?? vi.fn(async () => ({
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
      etag: 'etag-1',
      contentSha256: createHash('sha256').update('hello').digest('hex'),
      sizeBytes: 5,
      contentType: 'image/jpeg',
    })),
    get: vi.fn(),
    delete: vi.fn(),
  };
}

describe('uploadAndAnalyzeImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PRISMA_MOCK.imageAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: ASSET_ID,
      ownerUserId: data.ownerUserId,
      clientId: data.clientId,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      storagePath: data.storagePath,
      storageBackend: null,
      storageBucketAlias: null,
      storageKey: null,
      storageVersionId: null,
      storageEtag: null,
      contentSha256: null,
      storageState: null,
      storageMigratedAt: null,
      objectDeletedAt: null,
      lastStorageErrorCode: null,
      exifStripped: data.exifStripped,
      normalizedOrientation: data.normalizedOrientation,
      deletedAt: null,
      retentionDeletesAt: null,
    }));
    PRISMA_MOCK.imageAsset.update.mockResolvedValue(undefined);
    PRISMA_MOCK.imageAsset.findUniqueOrThrow.mockImplementation(async () => ({ id: ASSET_ID }));
    PRISMA_MOCK.imageAnalysis.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'analysis-1',
      ...data,
    }));
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'disabled', issues: [] });
  });

  it('1. local mode (write-mode disabled): writes to local disk, storageBackend stays null', async () => {
    const result = await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')]);

    expect(saveImageFile).toHaveBeenCalledWith(OWNER_ID, ASSET_ID, expect.any(String), expect.any(Buffer));
    expect(PRISMA_MOCK.imageAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: { storagePath: expect.stringContaining(ASSET_ID) },
    });
    expect(result).toHaveLength(1);
  });

  it('2. object-storage mode: routes to S3, persists exact version + integrity, never touches local disk', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage();
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')]);

    expect(saveImageFile).not.toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({
      key: `owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      contentType: 'image/jpeg',
    }));
    expect(storage.head).toHaveBeenCalledWith({
      bucketAlias: 'primary-images',
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: 'version-1',
    });
    expect(PRISMA_MOCK.imageAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: expect.objectContaining({
        storageBackend: 's3',
        storageBucketAlias: 'primary-images',
        storageKey: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
        storageVersionId: 'version-1',
        storageEtag: 'etag-1',
        storageState: 'available',
        storageMigratedAt: null,
        objectDeletedAt: null,
        lastStorageErrorCode: null,
      }),
    });
  });

  it('3. object-storage mode: put() failure fails closed, no local fallback, no available row', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage({ put: vi.fn(async () => { throw new Error('put failed'); }) });
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await expect(uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')])).rejects.toThrow();

    expect(saveImageFile).not.toHaveBeenCalled();
    expect(PRISMA_MOCK.imageAsset.update).not.toHaveBeenCalled();
  });

  it('4. object-storage mode: integrity mismatch (hash) fails closed, row never marked available', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage({
      head: vi.fn(async () => ({
        bucketAlias: 'primary-images',
        key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
        versionId: 'version-1',
        etag: 'etag-1',
        contentSha256: '0'.repeat(64),
        sizeBytes: 5,
        contentType: 'image/jpeg',
      })),
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await expect(uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')])).rejects.toThrow(/integrity/i);

    expect(PRISMA_MOCK.imageAsset.update).not.toHaveBeenCalled();
  });

  it('5. object-storage mode: size mismatch fails closed', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage({
      head: vi.fn(async () => ({
        bucketAlias: 'primary-images',
        key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
        versionId: 'version-1',
        etag: 'etag-1',
        contentSha256: createHash('sha256').update('hello').digest('hex'),
        sizeBytes: 999,
        contentType: 'image/jpeg',
      })),
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await expect(uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')])).rejects.toThrow(/integrity/i);
    expect(PRISMA_MOCK.imageAsset.update).not.toHaveBeenCalled();
  });

  it('6. object-storage mode: missing version id fails closed', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage({
      put: vi.fn(async ({ contentSha256 }: { contentSha256: string }) => ({
        backend: 's3',
        bucketAlias: 'primary-images',
        key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
        versionId: null,
        etag: 'etag-1',
        contentSha256,
        sizeBytes: 5,
      })),
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await expect(uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')])).rejects.toThrow(/integrity/i);
    expect(PRISMA_MOCK.imageAsset.update).not.toHaveBeenCalled();
  });

  it('7. enabled write-mode with a non-s3 config fails closed (misconfiguration), no silent local fallback', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue({ backend: 'local' });

    await expect(uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')])).rejects.toThrow();
    expect(saveImageFile).not.toHaveBeenCalled();
  });

  it('8. every file in a multi-file batch is routed identically (deterministic, no per-file coin-flip)', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage();
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);

    await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [
      fakeFile('a.jpg', 'image/jpeg', 'hello'),
      fakeFile('b.jpg', 'image/jpeg', 'hello'),
    ]);

    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(saveImageFile).not.toHaveBeenCalled();
  });

  it('9. computed contentSha256 matches the actual processed bytes', async () => {
    vi.mocked(validateObjectStorageWriteMode).mockReturnValue({ mode: 'enabled', issues: [] });
    vi.mocked(loadObjectStorageConfig).mockReturnValue(S3_CONFIG);
    const storage = fakeStorage();
    RESOLVE_STORAGE_MOCK.mockResolvedValue(storage);
    const expectedHash = createHash('sha256').update('hello').digest('hex');

    await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')]);

    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ contentSha256: expectedHash }));
  });

  it('10. creates a manual-only draft placeholder, never a fabricated AI result (M21)', async () => {
    await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')]);

    expect(PRISMA_MOCK.imageAnalysis.create).toHaveBeenCalledWith({
      data: {
        assetId: ASSET_ID,
        status: 'draft',
        providerName: 'manual-only',
        modelVersion: 'manual-1.0',
        analysisPayload: {
          hairType: 'unknown', density: 'unknown', porosity: 'unknown',
          faceShape: null, headShape: null, hairLength: null,
          hairTexture: null, hairCondition: null, growthPattern: null, targetShape: null,
        },
        confidences: {
          hairType: 0, density: 0, porosity: 0, faceShape: 0, headShape: 0,
          hairLength: 0, hairTexture: 0, hairCondition: 0, growthPattern: 0, targetShape: 0,
        },
        unknownFields: [
          'hairType', 'density', 'porosity', 'faceShape', 'headShape',
          'hairLength', 'hairTexture', 'hairCondition', 'growthPattern', 'targetShape',
        ],
        warnings: ['Manual review required for all fields'],
        limitations: ['No automated analysis available; awaiting human input'],
      },
    });
  });

  it('11. never produces a confident hairType/density/porosity guess for an unanalyzed upload', async () => {
    const result = await uploadAndAnalyzeImages(OWNER_ID, CLIENT_ID, [fakeFile('photo.jpg', 'image/jpeg', 'hello')]);

    expect(result[0].analysis.providerName).toBe('manual-only');
    expect((result[0].analysis.analysisPayload as { hairType: string }).hairType).toBe('unknown');
  });
});
