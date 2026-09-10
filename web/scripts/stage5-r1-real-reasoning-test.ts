// Stage 5.R1 -- ONE real Professional Reasoning provider call. DEV-ONLY,
// standalone, manually invoked. Mirrors scripts/tts-ab-latency-harness.ts's
// own exact discipline: relative imports (tsx resolves this project's own
// internal @/lib aliases automatically via tsconfig.json), .env.local
// loaded explicitly (raw tsx execution does not auto-load it the way
// Next.js/Vitest do), never prints the API key.
//
// ABSOLUTE LIMIT: provider.reason() is called EXACTLY ONCE, at EXACTLY
// ONE call site below (search REAL_CALL_SITE), inside a plain, retry-free,
// fallback-free control-flow. No loop, no catch-and-resubmit, no repair
// call. If it throws, this script reports the failure and exits -- it
// never attempts a second network request.
//
// This script requires deliberate, explicit acknowledgment on every run
// (STAGE5_R1_CONFIRM_REAL_CALL=yes) on top of a real, already-configured
// AI_ANALYSIS_* credential -- neither alone is sufficient. Never invoked
// by any npm script, the test suite, or the production build: it lives
// outside src/ and tests/ (vitest's own `include` is scoped to those two
// directories) and its filename does not end in .test.ts either.
//
// Run it like:
//   STAGE5_R1_CONFIRM_REAL_CALL=yes npx tsx scripts/stage5-r1-real-reasoning-test.ts

process.loadEnvFile(".env.local");

import { randomUUID } from "node:crypto";

import { prisma } from "../src/lib/prisma";
import { HEAD_ZONES } from "../src/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "../src/lib/hair-state-snapshot-validators";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL } from "../src/lib/cutting-skill-establish-central-nape-guide";
import { OCCIPITAL_TRANSITION_SKILL } from "../src/lib/cutting-skill-occipital-transition";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "../src/lib/cutting-skill-continue-central-nape-construction";
import type { ProfessionalSkillDefinitionRecord } from "../src/lib/professional-skill-registry-repository";
import { selectCandidateSkillsForDelta } from "../src/lib/hair-state-delta-skill-candidate-selector";
import { GeminiProfessionalReasoningProvider } from "../src/lib/professional-reasoning-provider-gemini";
import { runProfessionalReasoning } from "../src/lib/professional-reasoning-service";

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
function asRecord(skill: typeof ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL): ProfessionalSkillDefinitionRecord {
  return {
    id: `record-${skill.skillId}-v${skill.version}`,
    skillId: skill.skillId,
    version: skill.version,
    vertical: skill.vertical,
    name: skill.name,
    status: skill.status,
    authorityType: skill.authorityType,
    payload: skill,
    reviewedByUserId: skill.reviewedByUserId ?? null,
    reviewedAt: skill.reviewedAt ?? null,
    supersededBySkillDefinitionId: null,
    createdAt: skill.createdAt,
    updatedAt: skill.createdAt,
  };
}

async function main() {
  console.log("=== STAGE 5.R1 -- PRE-FLIGHT ===");

  // Explicit, deliberate acknowledgment gate -- this repo has no existing
  // "standard real-provider-test guard" to defer to (the established
  // scripts/tts-ab-latency-harness.ts precedent relies only on requiring
  // a real credential + manual scripts/ invocation), but this script is
  // uniquely consequential (a real, billed, external call), so it adds
  // one extra, cheap layer on top of that same precedent rather than
  // relying solely on credential presence: the operator must explicitly
  // opt in, every single run, by setting this exact variable. Checked
  // BEFORE any credential is even read, so a stray "AI_ANALYSIS_API_KEY
  // happens to be set" can never by itself cause a real call.
  if (process.env.STAGE5_R1_CONFIRM_REAL_CALL !== "yes") {
    console.log("PRE-FLIGHT: FAIL -- explicit acknowledgment missing. Set STAGE5_R1_CONFIRM_REAL_CALL=yes to proceed. This script makes exactly one real, billed provider call when it runs.");
    process.exit(1);
  }

  // --- 14: credential present, never printed ---
  const apiKey = process.env.AI_ANALYSIS_API_KEY;
  const model = process.env.AI_ANALYSIS_MODEL;
  const provider = process.env.AI_ANALYSIS_PROVIDER;
  if (!apiKey || !model || provider !== "gemini") {
    console.log("PRE-FLIGHT: FAIL -- AI_ANALYSIS_API_KEY / AI_ANALYSIS_MODEL / AI_ANALYSIS_PROVIDER=gemini not fully configured.");
    process.exit(1);
  }
  console.log(`provider: gemini, model: ${model}, apiKey: SET (length ${apiKey.length}, not printed)`);

  // --- Build the exact Stage 4/5 proof scenario, real skills only ---
  const registry: ProfessionalSkillDefinitionRecord[] = [
    asRecord(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL),
    asRecord(OCCIPITAL_TRANSITION_SKILL),
    asRecord(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL),
  ];

  const currentSnapshot = {
    id: "stage5-r1-current-v1",
    snapshotVersion: 1,
    payload: withZone(basePayload(), "nape", { relativeLength: { value: "long", source: "observed" as const } }),
    status: "DRAFT",
  };
  const targetSnapshot = {
    id: "stage5-r1-target-v1",
    snapshotVersion: 1,
    payload: withZone(
      withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" as const } }),
      "crown",
      { weightIntent: { value: "reduce", source: "professional_input" as const } },
    ),
    status: "DRAFT",
  };
  // occipital also carries a preserve intent, matching the Stage 4/5 proof exactly.
  targetSnapshot.payload = withZone(targetSnapshot.payload, "occipital", { lengthIntent: { value: "preserve", source: "professional_input" as const } });

  // --- 6-11: verify the deterministic pipeline locally, before spending the call ---
  const selection = selectCandidateSkillsForDelta(currentSnapshot, targetSnapshot, registry);
  console.log(`candidate skill matches: ${selection.candidateMatches.length}`);
  console.log(`unresolved deltas: ${selection.unresolvedDeltas.length}`);
  const hasUnresolvedCrown = selection.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent");
  const hasNapeOrOccipitalCandidate = selection.candidateMatches.some((m) => m.deltaEntry.scope === "nape" || m.deltaEntry.scope === "occipital");
  if (selection.candidateMatches.length === 0) {
    console.log("PRE-FLIGHT: FAIL -- zero candidate skills; a real call would add no reasoning value (deterministic BLOCKED_BY_MISSING_SKILL is the correct answer, not a paid call).");
    process.exit(1);
  }
  if (!hasUnresolvedCrown || !hasNapeOrOccipitalCandidate) {
    console.log("PRE-FLIGHT: FAIL -- scenario does not match the required shape (known + unsupported requirement both present).");
    process.exit(1);
  }
  console.log("PRE-FLIGHT: PASS -- scenario has both known/supported and unsupported requirements, as required.");

  // --- Real, clearly-labeled test fixtures (owner/client) for the FK-required persistence step ---
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  await prisma.user.create({
    data: { id: ownerUserId, email: `stage5-r1-real-test-${ownerUserId}@ai-hair-architect.local`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Stage 5.R1 Real Reasoning Test (synthetic, cleaned up after run)" } });
  console.log(`created synthetic test fixtures: ownerUserId=${ownerUserId}, clientId=${clientId}`);

  const realProvider = new GeminiProfessionalReasoningProvider({ apiKey, model });

  console.log("\n=== MAKING THE ONE AUTHORIZED REAL PROVIDER CALL NOW ===");
  let outcome;
  try {
    // REAL_CALL_SITE -- the ONE and ONLY provider.reason() invocation in
    // this entire script. No retry, no fallback, no second call below.
    outcome = await runProfessionalReasoning({
      ownerUserId,
      clientId,
      current: currentSnapshot,
      target: targetSnapshot,
      registry,
      provider: realProvider,
      professionalRequestText: "Preserve the nape and occipital length relationship established by the central guide; the client also wants less bulk at the crown.",
    });
  } catch (error) {
    console.log("\n=== VERDICT: FAIL -- REAL PROVIDER CALL FAILED ===");
    console.log("error:", error instanceof Error ? { name: error.name, message: error.message, code: (error as { code?: string }).code } : error);
    await cleanup(ownerUserId, clientId);
    process.exit(1);
  }

  console.log("\n=== OUTCOME ===");
  console.log("kind:", outcome.kind);

  if (outcome.kind === "rejected") {
    console.log("\n=== VERDICT: FAIL -- REAL PROVIDER PROPOSAL REJECTED SAFELY ===");
    console.log("rejectionReasons:", JSON.stringify(outcome.rejectionReasons, null, 2));
    console.log("contextFingerprint:", outcome.context.contextFingerprint);
    await cleanup(ownerUserId, clientId);
    process.exit(0);
  }

  if (outcome.kind === "persisted") {
    console.log("proposal id:", outcome.record.id);
    console.log("status:", outcome.record.status);
    console.log("provider/model:", outcome.record.provider, outcome.record.model);
    console.log("providerRequestId:", outcome.record.providerRequestId);
    console.log("contextFingerprint:", outcome.context.contextFingerprint);
    console.log("planSummary:", outcome.record.proposal.planSummary);
    console.log("reasoningStatus:", outcome.record.proposal.reasoningStatus);
    console.log("proposedSkills:", JSON.stringify(outcome.record.proposal.proposedSkills, null, 2));
    console.log("proposedOrder:", outcome.record.proposal.proposedOrder);
    console.log("preservationConstraints:", JSON.stringify(outcome.record.proposal.preservationConstraints, null, 2));
    console.log("unresolvedRequirements:", JSON.stringify(outcome.record.proposal.unresolvedRequirements, null, 2));
    console.log("clarifyingQuestions:", outcome.record.proposal.clarifyingQuestions);

    const usageRow = await prisma.aiUsageEvent.findFirst({ where: { ownerUserId, feature: "professional_reasoning" } });
    console.log("\n=== AI USAGE METERING ROW ===");
    console.log(usageRow ? JSON.stringify({ ...usageRow, id: undefined, ownerUserId: undefined }, null, 2) : "NONE FOUND");

    console.log("\n=== VERDICT: PASS (pending manual deterministic-validity confirmation in the written report) ===");
    await cleanup(ownerUserId, clientId);
    process.exit(0);
  }

  console.log("Unexpected outcome kind for this scenario:", outcome);
  await cleanup(ownerUserId, clientId);
  process.exit(1);
}

async function cleanup(ownerUserId: string, clientId: string) {
  console.log("\n=== CLEANUP ===");
  await prisma.aiUsageEvent.deleteMany({ where: { ownerUserId } });
  await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.user.deleteMany({ where: { id: ownerUserId } });
  console.log("synthetic test fixtures removed.");
}

main()
  .catch((error) => {
    console.error("UNEXPECTED SCRIPT ERROR (not a provider error):", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
