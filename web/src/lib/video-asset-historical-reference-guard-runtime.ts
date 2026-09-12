import { prisma } from "@/lib/prisma";
import type { HistoricalVideoReferenceDatabase } from "@/lib/video-asset-historical-reference-guard";

// VIDEO RETENTION SAFETY GATE, real wiring (Stage 8.5L2 Part 8/9). One
// `findMany` per source named in video-asset-historical-reference-guard.ts's
// own inventory comment -- mirrors image-asset-retention-runtime.ts's own
// historicalReferenceDatabase exactly. Exported (not just used
// internally) so a real-Postgres test can exercise these exact queries
// directly against real rows in each source table, rather than only
// re-testing the pure merge logic with fakes.
export const videoHistoricalReferenceDatabase: HistoricalVideoReferenceDatabase = {
  videoDemonstrationGenerationByGeneratedVideoAssetId: async (ids) => {
    const rows = await prisma.videoDemonstrationGeneration.findMany({
      where: { generatedVideoAssetId: { in: [...ids] } },
      select: { generatedVideoAssetId: true },
      distinct: ["generatedVideoAssetId"],
    });
    return rows.map((r) => r.generatedVideoAssetId).filter((v): v is string => v !== null);
  },
  technicalExecutionVideoGenerationByGeneratedVideoAssetId: async (ids) => {
    const rows = await prisma.technicalExecutionVideoGeneration.findMany({
      where: { generatedVideoAssetId: { in: [...ids] } },
      select: { generatedVideoAssetId: true },
      distinct: ["generatedVideoAssetId"],
    });
    return rows.map((r) => r.generatedVideoAssetId).filter((v): v is string => v !== null);
  },
  professionalLearningEvidenceByVideoAssetId: async (ids) => {
    const rows = await prisma.professionalLearningEvidence.findMany({
      where: { videoAssetId: { in: [...ids] } },
      select: { videoAssetId: true },
      distinct: ["videoAssetId"],
    });
    return rows.map((r) => r.videoAssetId).filter((v): v is string => v !== null);
  },
};
