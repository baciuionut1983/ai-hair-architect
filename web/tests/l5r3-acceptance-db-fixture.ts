import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { isValidApprovalDetail } from "@/lib/professional-learning-review-validators";

// Reuse the tracked replay's literal historical approval, never local DB/scratch truth.
const replay = fs.readFileSync(path.join(__dirname, "../src/lib/professional-knowledge-video-l5r3-1-real-replay.test.ts"), "utf8");
function literal(name: string): string {
  const match = replay.match(new RegExp(`const ${name} = "([^"]+)";`));
  if (!match) throw new Error(`Missing tracked approval literal: ${name}`);
  return match[1];
}
const ownerId = literal("REAL_OWNER_USER_ID");
const evidenceId = literal("REAL_SOURCE_EVIDENCE_ID");
const reviewId = literal("REAL_REVIEW_ID");
const themes = replay.match(/const REAL_CONFIRMED_THEMES = (\[[\s\S]*?\]);/);
if (!themes) throw new Error("Missing tracked confirmed themes");
const confirmedThemes: string[] = JSON.parse(themes[1].replace(/,\s*\]/, "]"));

export async function withL5R3AcceptanceFixture(run: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Acceptance fixture requires an isolated local test database");
  }
  const rollback = new Error("rollback test-owned acceptance fixture");
  try {
    await prisma.$transaction(async (db) => {
      // Serialize these exact frozen IDs, including when the tests run together.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(85331)`;
      await db.user.create({ data: { id: ownerId, email: "l5r3-frozen-approval@test.local", passwordHash: "test", role: "professional", locale: "en" } });
      await db.professionalLearningEvidence.create({ data: {
        id: evidenceId, ownerUserId: ownerId, createdByUserId: ownerId,
        evidenceType: "VIDEO", vertical: "hair_cutting", status: "ACTIVE",
        visibilityScope: "PRIVATE_LEARNING_EVIDENCE",
        provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING" },
        rightsClassification: "USER_OWNED_OR_AUTHORIZED",
        // Soft pointer only: no video bytes/provider/storage access is needed.
        videoAssetId: evidenceId,
      } });
      const approvalDetail = {
        provenance: "PROFESSIONAL_INPUT", confirmedThemes,
        reviewerNote: "Tracked frozen L5.R3.1 professional approval replay",
        fieldsChanged: false, unknownsRemoved: false, registryMutated: false,
        skillsCreated: false, falseStatementsFound: false,
      };
      if (!isValidApprovalDetail(approvalDetail) || L5R2_REAL_WINDOW_PLAN.sourceEvidenceId !== evidenceId) {
        throw new Error("Invalid tracked acceptance approval");
      }
      await db.professionalLearningReview.create({ data: {
        id: reviewId, ownerUserId: ownerId, sourceEvidenceId: evidenceId,
        reviewedExtractionVersion: L5R2_REAL_WINDOW_PLAN.segmentationVersion,
        approvedResultHash: literal("REAL_APPROVED_RESULT_HASH"),
        status: "PROFESSIONALLY_VALIDATED", approvalDetail: { ...approvalDetail },
        reviewedByUserId: ownerId, reviewedAt: new Date("2026-09-14T00:00:00Z"),
      } });
      await run(db);
      throw rollback;
    }, { timeout: 60_000, maxWait: 60_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  // Rollback must remove every fixture record; never delete historical rows.
  const remaining = await Promise.all([
    prisma.user.count({ where: { id: ownerId } }),
    prisma.professionalLearningEvidence.count({ where: { id: evidenceId } }),
    prisma.professionalLearningReview.count({ where: { id: reviewId } }),
  ]);
  if (remaining.some(Boolean)) throw new Error("Acceptance fixture leaked records");
}
