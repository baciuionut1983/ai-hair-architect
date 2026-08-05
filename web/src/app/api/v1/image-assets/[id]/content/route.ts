import { Readable } from 'stream';

import { NextRequest, NextResponse } from 'next/server';

import { ConfinedImageStorageError, createConfinedImageReadStream } from '@/lib/image-storage';
import { ImageAssetStorageRepository } from '@/lib/image-asset-storage-repository';
import { createObjectStorageAliasResolver } from '@/lib/object-storage-alias-resolver';
import { ObjectStorageError } from '@/lib/object-storage-errors';
import { toExactObjectReference } from '@/lib/object-storage';
import { prisma } from '@/lib/prisma';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

const SERVABLE_OBJECT_STATES = new Set(['available', 'delete_pending']);

// Storage-layer errors that reflect an inconsistent persisted row (never the
// external provider itself) fail closed as 409, not 500.
const INCONSISTENT_STATE_CODES = new Set(['configuration', 'missing_version', 'invalid_state']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await resolvePipelineAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Owner-scoped in the query itself: another owner's asset is never fetched,
  // so it is indistinguishable from a genuinely absent one.
  const asset = await prisma.imageAsset.findFirst({
    where: { id, ownerUserId: user.id },
  });

  if (!asset || asset.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (asset.storageBackend === null || asset.storageBackend === undefined) {
    return serveLegacyLocal(asset);
  }

  if (asset.storageBackend === 's3') {
    return serveObjectBacked(user.id, id, asset);
  }

  return NextResponse.json({ error: 'Asset storage is not available.' }, { status: 409 });
}

async function serveLegacyLocal(asset: {
  storagePath: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}): Promise<NextResponse> {
  if (asset.storagePath === 'pending') {
    return NextResponse.json({ error: 'Asset storage is not available.' }, { status: 409 });
  }

  try {
    const { stream, sizeBytes } = await createConfinedImageReadStream(asset.storagePath);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: buildHeaders(asset, sizeBytes),
    });
  } catch (error) {
    if (error instanceof ConfinedImageStorageError) {
      return NextResponse.json({ error: 'Asset storage is not available.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to read image.' }, { status: 500 });
  }
}

async function serveObjectBacked(
  ownerUserId: string,
  assetId: string,
  asset: { storageState: string | null; mimeType: string; fileName: string; sizeBytes: number }
): Promise<NextResponse> {
  if (!asset.storageState || !SERVABLE_OBJECT_STATES.has(asset.storageState)) {
    return NextResponse.json({ error: 'Asset storage is not available.' }, { status: 409 });
  }

  try {
    const repository = new ImageAssetStorageRepository(prisma);
    const reference = await repository.findObjectReferenceByOwner(ownerUserId, assetId);
    if (!reference) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Never requests "latest": throws unless a complete, exact object version
    // is present on the persisted reference.
    const exact = toExactObjectReference(reference);

    const resolveObjectStorage = createObjectStorageAliasResolver();
    const storage = await resolveObjectStorage(exact.bucketAlias);
    if (!storage) {
      return NextResponse.json({ error: 'Object storage is unavailable.' }, { status: 500 });
    }

    const stored = await storage.get({
      bucketAlias: exact.bucketAlias,
      key: exact.key,
      versionId: exact.versionId,
    });

    return new NextResponse(stored.body, {
      status: 200,
      headers: buildHeaders(asset, stored.sizeBytes),
    });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      const status = INCONSISTENT_STATE_CODES.has(error.code) ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof TypeError) {
      // toExactObjectReference() throws a plain TypeError for an incomplete reference.
      return NextResponse.json({ error: 'Asset storage is not available.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to read image.' }, { status: 500 });
  }
}

function buildHeaders(
  asset: { mimeType: string; fileName: string; sizeBytes: number },
  verifiedSizeBytes: number
): HeadersInit {
  const safeFileName = asset.fileName.replace(/["\r\n]/g, '');
  const headers: Record<string, string> = {
    'Content-Type': asset.mimeType,
    'Content-Disposition': `inline; filename="${safeFileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  if (Number.isSafeInteger(verifiedSizeBytes) && verifiedSizeBytes >= 0) {
    headers['Content-Length'] = String(verifiedSizeBytes);
  }

  return headers;
}
