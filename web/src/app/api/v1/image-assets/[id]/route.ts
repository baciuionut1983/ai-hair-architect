import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await resolvePipelineAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const asset = await prisma.imageAsset.findUnique({
      where: { id },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (asset.ownerUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (asset.deletedAt) {
      return NextResponse.json({ error: 'Asset deleted' }, { status: 410 });
    }

    return NextResponse.json({ asset });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Download failed';
    return NextResponse.json(
      { error },
      { status: 500 }
    );
  }
}
