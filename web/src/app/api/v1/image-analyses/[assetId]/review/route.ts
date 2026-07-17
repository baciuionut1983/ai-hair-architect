import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reviewAnalysis } from '@/lib/image-analysis-service';
import { mapAnalysisToM8Draft } from '@/lib/image-analysis-m8-mapper';
import { ImageAnalysisResult } from '@/lib/image-analysis-provider';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { corrections, finalizeToM8 } = await req.json() as {
      corrections: Record<string, string>;
      finalizeToM8: boolean;
    };

    const asset = await prisma.imageAsset.findUnique({
      where: { id: assetId },
      include: {
        analyses: {
          where: { status: 'draft' },
          take: 1,
        },
      },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (asset.ownerUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!asset.analyses.length) {
      return NextResponse.json({ error: 'No draft analysis' }, { status: 400 });
    }

    const analysis = asset.analyses[0];
    const updated = await reviewAnalysis(analysis.id, corrections, user.id);

    if (finalizeToM8) {
      const m8Draft = mapAnalysisToM8Draft({
        analysisResult: updated.analysisPayload as unknown as ImageAnalysisResult,
        confidences: updated.confidences as Record<string, number>,
        unknownFields: updated.unknownFields as string[],
      });

      const analysisRecord = await prisma.analysis.create({
        data: {
          id: `m8-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          clientId: asset.clientId,
          ownerUserId: user.id,
          goal: 'hair_analysis',
          hairType: m8Draft.hairType || '',
          density: m8Draft.density || '',
          porosity: m8Draft.porosity || '',
          phase: 'analysis',
          clarificationRound: 0,
          confidenceScore: Object.values(m8Draft.mappingConfidence).reduce((a: number, b: number) => a + b, 0) / Object.keys(m8Draft.mappingConfidence).length,
          uncertaintyReasons: m8Draft.warnings,
          followUpQuestions: [],
          recommendations: [],
          safetyNotes: [],
          clarificationAnswers: [],
          faceShape: m8Draft.faceShape,
          headShape: m8Draft.headShape,
          hairLength: m8Draft.hairLength,
          hairTexture: m8Draft.hairTexture,
          hairCondition: m8Draft.hairCondition,
          growthPattern: m8Draft.growthPattern,
          targetShape: m8Draft.targetShape,
          imageAssetId: asset.id,
          imageAnalysisId: analysis.id,
          m8DraftCreatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        analysis: {
          analysisId: updated.id,
          status: updated.status,
          m8DraftId: analysisRecord.id,
          m8Draft,
        },
      });
    }

    return NextResponse.json({
      success: true,
      analysis: {
        analysisId: updated.id,
        status: updated.status,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Review failed';
    return NextResponse.json(
      { error },
      { status: 400 }
    );
  }
}

async function getAuthenticatedUser(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  return session?.user || null;
}
