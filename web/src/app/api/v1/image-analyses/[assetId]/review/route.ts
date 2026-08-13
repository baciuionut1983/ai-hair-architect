import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reviewAnalysis } from '@/lib/image-analysis-service';
import { ImageAnalysisResult } from '@/lib/image-analysis-provider';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

import { enrichTechnicalPlanExplanations } from '@/lib/ai-explainer';
import { analyzeInitial } from '@/lib/analysis-engine';
import {
  AnalysisConcurrencyError,
  AnalysisDependencyError,
  analysisPersistenceUnavailableResponse,
  createAnalysisForOwner,
  isAnalysisPersistenceError
} from '@/lib/analysis-repository';
import { DENSITY_OPTIONS, GOAL_OPTIONS, HAIR_TYPE_OPTIONS, POROSITY_OPTIONS } from '@/lib/analysis-field-options';
import { mapPhotoAnalysisToRequestFields } from '@/lib/photo-analysis-request-mapper';
import { shouldGenerateColorPlan } from '@/lib/color-plan-engine';
import { shouldGenerateTreatmentPlan } from '@/lib/treatment-plan-engine';
import type { AnalysisRequest, AnalysisResponse, DensityLevel, PorosityLevel } from '@/lib/contracts';

const VALID_GOALS = GOAL_OPTIONS.map((option) => option.value);
const VALID_HAIR_TYPES = HAIR_TYPE_OPTIONS.map((option) => option.value);
const VALID_DENSITIES = DENSITY_OPTIONS.map((option) => option.value);
const VALID_POROSITIES = POROSITY_OPTIONS.map((option) => option.value);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await resolvePipelineAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { corrections, finalizeToM8, goal, hairType, density, porosity } = await req.json() as {
      corrections: Record<string, string>;
      finalizeToM8: boolean;
      goal?: string;
      hairType?: string;
      density?: string;
      porosity?: string;
    };

    const asset = await prisma.imageAsset.findUnique({
      where: { id: assetId },
      include: {
        // No take: 1 -- deliberately fetches every draft row so a leftover
        // historical duplicate (pre-M21) is detected and rejected explicitly
        // rather than silently resolved by picking an arbitrary one.
        // orderBy is the canonical ordering (most recent first) for the
        // single-row case; it does not paper over an actual duplicate.
        analyses: {
          where: { status: 'draft' },
          orderBy: { createdAt: 'desc' },
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

    if (asset.analyses.length > 1) {
      return NextResponse.json({ error: 'ANALYSIS_STATE_INTEGRITY_ERROR' }, { status: 409 });
    }

    const analysis = asset.analyses[0];

    // M31 GO-4: every finalize precondition is checked against the
    // pre-review payload (the same corrections-merge reviewAnalysis itself
    // performs) BEFORE reviewAnalysis is called. reviewAnalysis mutates the
    // draft (draft -> confirmed); an invalid finalize request must never
    // consume that draft and leave it stranded with no Analysis row to
    // show for it.
    if (finalizeToM8) {
      if (
        !isOneOf(goal, VALID_GOALS) ||
        !isOneOf(hairType, VALID_HAIR_TYPES) ||
        (density !== undefined && !isOneOf(density, VALID_DENSITIES)) ||
        (porosity !== undefined && !isOneOf(porosity, VALID_POROSITIES))
      ) {
        return NextResponse.json({ error: 'Invalid finalize payload.' }, { status: 400 });
      }

      const mergedPayload = Object.assign({}, (analysis.analysisPayload as Record<string, unknown>) || {}, corrections);
      const previewMapped = mapPhotoAnalysisToRequestFields(mergedPayload as unknown as ImageAnalysisResult);
      const previewDensity = (density as DensityLevel | undefined) ?? previewMapped.density;
      const previewPorosity = (porosity as PorosityLevel | undefined) ?? previewMapped.porosity;

      if (!previewDensity || !previewPorosity) {
        return NextResponse.json(
          { error: 'AI_COULD_NOT_DETERMINE_DENSITY_OR_POROSITY', message: 'density and porosity could not be read from the photo; please provide them.' },
          { status: 400 }
        );
      }
    }

    const updated = await reviewAnalysis(analysis.id, corrections, user.id);

    if (!finalizeToM8) {
      return NextResponse.json({
        success: true,
        analysis: {
          analysisId: updated.id,
          status: updated.status,
        },
      });
    }

    const mapped = mapPhotoAnalysisToRequestFields(updated.analysisPayload as unknown as ImageAnalysisResult);
    const resolvedDensity: DensityLevel | undefined = (density as DensityLevel | undefined) ?? mapped.density;
    const resolvedPorosity: PorosityLevel | undefined = (porosity as PorosityLevel | undefined) ?? mapped.porosity;

    if (!resolvedDensity || !resolvedPorosity) {
      // Guarded above via the identical pre-review merge preview -- this is
      // an internal-consistency fallback, not expected to be reachable.
      return NextResponse.json({ error: 'AI_COULD_NOT_DETERMINE_DENSITY_OR_POROSITY' }, { status: 400 });
    }

    const analysisRequest: AnalysisRequest = {
      clientId: asset.clientId,
      goal: goal as AnalysisRequest['goal'],
      hairType: hairType as AnalysisRequest['hairType'],
      density: resolvedDensity,
      porosity: resolvedPorosity,
      faceShape: mapped.faceShape,
      headShape: mapped.headShape,
      hairLength: mapped.hairLength,
      hairTexture: mapped.hairTexture,
      hairCondition: mapped.hairCondition,
      growthPattern: mapped.growthPattern,
      targetShape: mapped.targetShape,
    };

    const requestsTechnicalPlan =
      analysisRequest.goal === 'reshape' ||
      Boolean(
        analysisRequest.faceShape ||
        analysisRequest.headShape ||
        analysisRequest.hairLength ||
        analysisRequest.hairTexture ||
        analysisRequest.hairCondition ||
        analysisRequest.growthPattern ||
        analysisRequest.targetShape
      );
    const requestsColorPlan = shouldGenerateColorPlan(analysisRequest);
    const requestsTreatmentPlan = shouldGenerateTreatmentPlan(analysisRequest);

    if ((requestsTechnicalPlan || requestsColorPlan || requestsTreatmentPlan) && user.role === 'consumer') {
      return NextResponse.json(
        { error: 'Advanced technical analysis (cutting, color, or treatment) is restricted to professional or salon roles.' },
        { status: 403 }
      );
    }

    const analysisSeed = analyzeInitial(analysisRequest);
    const technicalCutPlan = analysisSeed.technicalCutPlan
      ? await enrichTechnicalPlanExplanations(analysisSeed.technicalCutPlan)
      : undefined;

    let record;
    try {
      record = await createAnalysisForOwner(user.id, asset.clientId, {
        ...analysisSeed,
        technicalCutPlan,
        imageAssetId: asset.id,
        imageAnalysisId: analysis.id,
      });
    } catch (error) {
      if (error instanceof AnalysisConcurrencyError) {
        return NextResponse.json({ error: error.message }, { status: error.httpStatus });
      }
      if (error instanceof AnalysisDependencyError) {
        return NextResponse.json({ error: error.message }, { status: error.httpStatus });
      }
      if (isAnalysisPersistenceError(error)) {
        return analysisPersistenceUnavailableResponse();
      }
      throw error;
    }

    const result: AnalysisResponse = {
      analysisId: record.id,
      phase: record.phase,
      clarificationRound: record.clarificationRound,
      confidenceScore: record.confidenceScore,
      uncertaintyReasons: record.uncertaintyReasons,
      followUpQuestions: record.followUpQuestions,
      recommendations: record.recommendations,
      safetyNotes: record.safetyNotes,
      technicalCutPlan: record.technicalCutPlan,
      colorPlan: record.colorPlan,
      treatmentPlan: record.treatmentPlan,
      imageAssetId: record.imageAssetId ?? null,
    };

    return NextResponse.json({
      success: true,
      analysis: {
        analysisId: updated.id,
        status: updated.status,
      },
      result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Review failed';
    return NextResponse.json(
      { error },
      { status: 400 }
    );
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
