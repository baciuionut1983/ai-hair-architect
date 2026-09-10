import { randomUUID } from "crypto";

import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { isHairStateSnapshotPayload, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import {
  buildProfessionalReasoningContext,
  type ProfessionalReasoningContext,
  type ProfessionalReasoningEvidenceSummary,
  type ProfessionalReasoningProposal,
} from "@/lib/professional-reasoning-contracts";
import { type ProfessionalReasoningProvider } from "@/lib/professional-reasoning-provider";
import { validateProfessionalReasoningProposal } from "@/lib/professional-reasoning-validator";
import {
  createDraftReasoningProposal,
  findReasoningProposalByFingerprint,
  type ProfessionalReasoningProposalRecord,
} from "@/lib/professional-reasoning-repository";

// AI Hair Architect, Professional Skill Engine Stage 5 -- PROFESSIONAL
// REASONING SERVICE. The one orchestration entry point tying Parts A-J
// together: deterministic pre-checks -> deterministic short-circuit where
// possible -> provider call -> mandatory validation -> persistence ->
// cost metering (real provider only). This is the ONLY file in Stage 5
// that touches I/O (DB, provider) directly -- contracts/validator/
// selector/condition-evaluator all stay pure.
//
// COST DISCIPLINE (Part H, this engagement's permanent principle: THINK
// CHEAP -> VALIDATE CHEAP -> GENERATE ONLY WHAT MUST BE GENERATED ->
// VERIFY -> REGENERATE ONLY THE FAILURE): every deterministic check below
// runs BEFORE any provider call, and a provider call is skipped entirely
// whenever Stage 4's own selector already, deterministically, has nothing
// for the AI to reason about (zero candidate skills matched) -- in that
// case this function builds and persists the DETERMINISTIC answer itself,
// never spending a token to have a model restate what deterministic code
// already knows.
//
// IDEMPOTENCY (Part O): before calling any provider, this function checks
// for an existing proposal with the SAME contextFingerprint/provider/
// model -- an identical reasoning request is never paid for twice. The
// DB's own @@unique([contextFingerprint, provider, model]) is the final
// backstop.
//
// NO PAID EVENT FOR A MOCKED CALL (Part J): recordAiUsageEvent is only
// ever invoked when provider.name does not start with "fake" -- the exact
// same naming convention FakeProfessionalReasoningProvider/
// AlwaysFailingProfessionalReasoningProvider already use.

export interface RunProfessionalReasoningSnapshotInput {
  id: string;
  snapshotVersion: number;
  payload: HairStateSnapshotPayload;
  status: string;
}

export interface RunProfessionalReasoningInput {
  ownerUserId: string;
  clientId: string;
  current: RunProfessionalReasoningSnapshotInput;
  target: RunProfessionalReasoningSnapshotInput;
  registry: readonly ProfessionalSkillDefinitionRecord[];
  provider: ProfessionalReasoningProvider;
  professionalRequestText?: string;
  currentEvidence?: readonly ProfessionalReasoningEvidenceSummary[];
  targetEvidence?: readonly ProfessionalReasoningEvidenceSummary[];
  correlationId?: string;
}

export type RunProfessionalReasoningOutcome =
  | { kind: "deterministic"; context: ProfessionalReasoningContext; record: ProfessionalReasoningProposalRecord }
  | { kind: "reused"; context: ProfessionalReasoningContext; record: ProfessionalReasoningProposalRecord }
  | { kind: "persisted"; context: ProfessionalReasoningContext; record: ProfessionalReasoningProposalRecord }
  | { kind: "rejected"; context: ProfessionalReasoningContext; rejectionReasons: readonly string[] }
  | { kind: "blocked"; reason: string };

export async function runProfessionalReasoning(input: RunProfessionalReasoningInput): Promise<RunProfessionalReasoningOutcome> {
  // --- Deterministic pre-checks -- zero provider calls for any of these. ---
  if (!isHairStateSnapshotPayload(input.current.payload)) {
    return { kind: "blocked", reason: "CURRENT snapshot payload is not structurally valid." };
  }
  if (!isHairStateSnapshotPayload(input.target.payload)) {
    return { kind: "blocked", reason: "TARGET snapshot payload is not structurally valid." };
  }
  if (input.target.status === "SUPERSEDED") {
    return { kind: "blocked", reason: "TARGET snapshot is SUPERSEDED; reasoning must run against current authority, not stale state." };
  }

  const selection = selectCandidateSkillsForDelta(
    { id: input.current.id, snapshotVersion: input.current.snapshotVersion, payload: input.current.payload },
    { id: input.target.id, snapshotVersion: input.target.snapshotVersion, payload: input.target.payload },
    input.registry,
  );

  const context = buildProfessionalReasoningContext({
    selection,
    professionalRequestText: input.professionalRequestText,
    currentEvidence: input.currentEvidence,
    targetEvidence: input.targetEvidence,
  });

  // --- Deterministic short-circuit: zero candidate skills means zero
  // reasoning value an AI call could add -- build the answer directly. ---
  if (context.candidateSkills.length === 0) {
    const deterministicProposal = buildDeterministicProposal(context);
    const record = await createDraftReasoningProposal({
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      context,
      provider: "deterministic",
      model: "none",
      proposal: deterministicProposal,
    });
    return { kind: "deterministic", context, record };
  }

  // --- Idempotency: an identical request to the same provider/model is
  // never paid for twice. ---
  const existing = await findReasoningProposalByFingerprint(context.contextFingerprint, input.provider.name, input.provider.modelVersion);
  if (existing) {
    return { kind: "reused", context, record: existing };
  }

  const correlationId = input.correlationId ?? randomUUID();
  const startedAt = Date.now();
  const outcome = await input.provider.reason(context);

  const validation = validateProfessionalReasoningProposal(outcome.rawProposal, context, input.registry);

  const isRealProvider = !input.provider.name.startsWith("fake");
  if (isRealProvider) {
    await recordAiUsageEvent({
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      feature: "professional_reasoning",
      modality: "TEXT_GENERATION",
      correlationId,
      provider: input.provider.name,
      model: input.provider.modelVersion,
      providerRequestId: outcome.providerRequestId ?? null,
      usage: outcome.usage,
      outcome: validation.valid ? "SUCCEEDED" : "FAILED",
      errorCategory: validation.valid ? null : "VALIDATION_REJECTED",
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!validation.valid) {
    return { kind: "rejected", context, rejectionReasons: validation.rejectionReasons };
  }

  const record = await createDraftReasoningProposal({
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    context,
    provider: input.provider.name,
    model: input.provider.modelVersion,
    providerRequestId: outcome.providerRequestId ?? null,
    proposal: validation.proposal,
  });

  return { kind: "persisted", context, record };
}

function buildDeterministicProposal(context: ProfessionalReasoningContext): ProfessionalReasoningProposal {
  const hasUnresolved = context.unresolvedDeltas.length > 0;
  return {
    schemaVersion: context.schemaVersion,
    planSummary: hasUnresolved
      ? "No registered professional skill can currently address the required transformation(s) in this context."
      : "No transformation is required -- the current state already satisfies every stated target requirement.",
    proposedSkills: [],
    proposedOrder: [],
    preservationConstraints: context.preserveConstraints,
    unresolvedRequirements: context.unresolvedDeltas.map((e) => ({ scope: e.scope, field: e.field, reason: `No candidate skill declares a capability addressing ${e.field} (${e.transformation}) at ${e.scope}.` })),
    clarifyingQuestions: [],
    reasoningStatus: hasUnresolved ? "BLOCKED_BY_MISSING_SKILL" : "COMPLETE_CANDIDATE_PLAN",
  };
}
