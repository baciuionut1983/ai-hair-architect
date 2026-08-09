import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await resolvePipelineAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const asset = await prisma.imageAsset.findUnique({
      where: { id: assetId },
      include: { analyses: true },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (asset.ownerUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      asset: {
        id: asset.id,
        fileName: asset.fileName,
        uploadedAt: asset.uploadedAt,
      },
      analyses: asset.analyses,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json(
      { error },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await resolvePipelineAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const asset = await prisma.imageAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (asset.ownerUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // M36: real deletion of the underlying object (local file or S3
    // object) is deferred to the retention purge job, which runs only
    // after retentionDeletesAt has passed -- this route only schedules
    // the asset for deletion. Deleting the file immediately here (as
    // before M36) contradicted the 30-day retention window it claimed,
    // and never touched S3-backed assets at all, permanently orphaning
    // their real objects with no path to ever clean them up.
    await prisma.imageAsset.update({
      where: { id: assetId },
      data: {
        deletedAt: new Date(),
        retentionDeletesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        // Keeps the row consistent with the M15.v2 backup contract, which
        // requires an object-backed asset's storageState to be
        // "delete_pending" whenever deletedAt is set -- an "available"
        // S3-backed asset with deletedAt set is rejected as invalid by
        // backup creation (backup-m15-v2-snapshot-persistence.ts).
        ...(asset.storageBackend === 's3' ? { storageState: 'delete_pending' as const } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Delete failed';
    return NextResponse.json(
      { error },
      { status: 500 }
    );
  }
}
