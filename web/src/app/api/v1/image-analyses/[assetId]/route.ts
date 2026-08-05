import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteImageFile } from '@/lib/image-storage';
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

    try {
      await deleteImageFile(asset.storagePath);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }

    await prisma.imageAsset.update({
      where: { id: assetId },
      data: {
        deletedAt: new Date(),
        retentionDeletesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
