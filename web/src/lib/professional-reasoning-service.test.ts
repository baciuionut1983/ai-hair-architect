import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import type { SkillDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL } from "@/lib/cutting-skill-establish-central-nape-guide";
import { OCCIPITAL_TRANSITION_SKILL } from "@/lib/cutting-skill-occipital-transition";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import type { ProfessionalReasoningContext, ProfessionalReasoningProposal } from "@/lib/professional-reasoning-contracts";
import { ProfessionalReasoningProvider, type ProfessionalReasoningProviderOutcome } from "@/lib/professional-reasoning-provider";
import { runProfessionalReasoning } from "@/lib/professional-reasoning-service";

// Professional Skill Engine, Stage 5 -- PROFESSIONAL REASONING SERVICE.
// Cost discipline, provider abstraction, and the Part L first end-to-end
// mocked reasoning proof. Real Postgres for persistence assertions; the
// provider is ALWAYS a deterministic fake -- no real network call, no SDK,
// no API key, anywhere in this file.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

class CountingProvider extends ProfessionalReasoningProvider {
  readonly name = "fake-deterministic";
  readonly modelVersion = "fake-1.0";
  callCount = 0;
  constructor(private readonly response: unknown) {
    super();
  }
  async reason(): Promise<ProfessionalReasoningProviderOutcome> {
    this.callCount += 1;
    return { rawProposal: this.response, providerRequestId: "fake-req", usage: { outputTokens: 10 } };
  }
}

suite("runProfessionalReasoning (service, real Postgres, mocked provider only)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.aiUsageEvent.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalReasoningProposal.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // 33. invalid deterministic input causes zero provider calls
  it("33. an invalid CURRENT payload blocks before any provider call", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const provider = new CountingProvider(null);
    const outcome = await runProfessionalReasoning({
      ownerUserId,
      clientId,
      current: { id: "c", snapshotVersion: 1, payload: { not: "valid" } as unknown as HairStateSnapshotPayload, status: "DRAFT" },
      target: { id: "t", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      registry: [],
      provider,
    });
    expect(outcome.kind).toBe("blocked");
    expect(provider.callCount).toBe(0);
  });

  // 34. deterministic BLOCKED_BY_MISSING_SKILL avoids unnecessary provider call
  it("34. zero candidate skills short-circuits to a deterministic proposal -- the provider is never called", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const provider = new CountingProvider(null);
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const outcome = await runProfessionalReasoning({
      ownerUserId,
      clientId,
      current: { id: "c", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "t", snapshotVersion: 1, payload: target, status: "DRAFT" },
      registry: [],
      provider,
    });
    expect(outcome.kind).toBe("deterministic");
    expect(provider.callCount).toBe(0);
    if (outcome.kind === "deterministic") {
      expect(outcome.record.proposal.reasoningStatus).toBe("BLOCKED_BY_MISSING_SKILL");
      expect(outcome.record.provider).toBe("deterministic");
    }
  });

  it("34b. no transformation required at all -> deterministic COMPLETE_CANDIDATE_PLAN, zero provider calls", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const provider = new CountingProvider(null);
    const outcome = await runProfessionalReasoning({
      ownerUserId,
      clientId,
      current: { id: "c", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "t", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      registry: [],
      provider,
    });
    expect(outcome.kind).toBe("deterministic");
    if (outcome.kind === "deterministic") expect(outcome.record.proposal.reasoningStatus).toBe("COMPLETE_CANDIDATE_PLAN");
  });

  // Idempotency -- an identical request never calls the provider twice.
  it("idempotency: an identical context/provider/model reuses the existing proposal instead of a second provider call", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const skill = weightReducingSkill();
    const registry = [asRecord(skill)];
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const buildInput = () => ({
      ownerUserId,
      clientId,
      current: { id: "current-idem", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "target-idem", snapshotVersion: 1, payload: target, status: "DRAFT" },
      registry,
    });

    const first = await runProfessionalReasoning({ ...buildInput(), provider: buildRespondingProvider(buildInput(), registry) });
    expect(first.kind).toBe("persisted");

    const provider2 = new CountingProvider("unused");
    const second = await runProfessionalReasoning({ ...buildInput(), provider: provider2 });
    expect(second.kind).toBe("reused");
    expect(provider2.callCount).toBe(0);
  });

  // Cost metering: a real-named provider records AiUsageEvent; a fake one never does.
  it("cost metering: a real-named provider records exactly one AiUsageEvent; a fake provider records none", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const skill = weightReducingSkill();
    const registry = [asRecord(skill)];
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const input = {
      ownerUserId,
      clientId,
      current: { id: "current-real", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "target-real", snapshotVersion: 1, payload: target, status: "DRAFT" },
      registry,
    };
    const withResponse = buildRespondingProvider(input, registry, "test-real-provider");
    const outcome = await runProfessionalReasoning({ ...input, provider: withResponse });
    expect(outcome.kind).toBe("persisted");

    const usageEvents = await prisma.aiUsageEvent.findMany({ where: { ownerUserId, feature: "professional_reasoning" } });
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].provider).toBe("test-real-provider");

    // A second, independent context with a FAKE provider records nothing.
    const target2 = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const input2 = {
      ownerUserId,
      clientId,
      current: { id: "current-fake", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "target-fake", snapshotVersion: 1, payload: target2, status: "DRAFT" },
      registry,
    };
    const fakeProvider = buildRespondingProvider(input2, registry);
    await runProfessionalReasoning({ ...input2, provider: fakeProvider });
    const usageEventsAfter = await prisma.aiUsageEvent.findMany({ where: { ownerUserId, feature: "professional_reasoning" } });
    expect(usageEventsAfter).toHaveLength(1); // still just the one from the real-named provider.
  });

  // A rejected (invalid) proposal is never persisted and never silently upgraded.
  it("a provider returning a malformed response is rejected end-to-end and never persisted", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const skill = weightReducingSkill();
    const registry = [asRecord(skill)];
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const provider = new CountingProvider({ garbage: "not a real proposal" });
    const outcome = await runProfessionalReasoning({
      ownerUserId,
      clientId,
      current: { id: "c-mal", snapshotVersion: 1, payload: basePayload(), status: "DRAFT" },
      target: { id: "t-mal", snapshotVersion: 1, payload: target, status: "DRAFT" },
      registry,
      provider,
    });
    expect(outcome.kind).toBe("rejected");
    const rows = await prisma.professionalReasoningProposal.findMany({ where: { ownerUserId } });
    expect(rows).toHaveLength(0);
  });

  // 35/36. source-level: no SDK, no API client, IMPORTED anywhere in the
  // reasoning stack. Checks real `import ... from "..."` / `require(...)`
  // statements only -- deliberately NOT a bare keyword search, since this
  // file's own header comments legitimately discuss why no vendor name
  // was hardcoded (e.g. "not Gemini/OpenAI/Claude specifically"), and a
  // keyword-only check would wrongly flag that honest architectural
  // reasoning as if it were a real import.
  it("35/36. no AI SDK/network client is imported anywhere in the reasoning stack -- mock provider only", () => {
    const importLike = /(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["'])|(?:require\(\s*["']([^"']+)["']\s*\))/g;
    for (const file of ["professional-reasoning-service.ts", "professional-reasoning-provider.ts", "professional-reasoning-validator.ts", "professional-reasoning-contracts.ts"]) {
      const source = readFileSync(join(process.cwd(), "src", "lib", file), "utf8");
      const importedModules = [...source.matchAll(importLike)].map((m) => m[1] ?? m[2]);
      for (const moduleName of importedModules) {
        expect(/gemini|openai|anthropic|@google\/generative-ai|^https?:/i.test(moduleName)).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // PART L -- first end-to-end professional reasoning proof, using ONLY the
  // 3 real, already-authorized skills.
  // -------------------------------------------------------------------------

  it("PROOF: STATE -> DELTA -> SKILLS -> AI REASONING -> VALIDATED PROFESSIONAL PROPOSAL, using only the 3 real skills, with one honest BLOCKED requirement", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const registry: ProfessionalSkillDefinitionRecord[] = [
      asRecord(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL),
      asRecord(OCCIPITAL_TRANSITION_SKILL),
      asRecord(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL),
    ];

    const current = withZone(basePayload(), "nape", { relativeLength: { value: "long", source: "observed" } });
    const target = withZone(
      withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }),
      "crown",
      { weightIntent: { value: "reduce", source: "professional_input" } },
    );

    const input = {
      ownerUserId,
      clientId,
      current: { id: "current-proof", snapshotVersion: 1, payload: current, status: "DRAFT" },
      target: { id: "target-proof", snapshotVersion: 1, payload: target, status: "DRAFT" },
      registry,
    };

    const provider = buildRespondingProvider(input, registry);
    const outcome = await runProfessionalReasoning({ ...input, provider });

    expect(outcome.kind).toBe("persisted");
    if (outcome.kind !== "persisted") return;

    expect(outcome.record.status).toBe("DRAFT"); // never auto-confirmed.
    const proposal = outcome.record.proposal;
    expect(proposal.proposedSkills.some((s) => s.skillKey === ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId || s.skillKey === CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId)).toBe(true);
    // The crown weight-reduction requirement is honestly reported as
    // unresolved -- never solved by an invented skill.
    expect(proposal.unresolvedRequirements.some((r) => r.scope === "crown" && r.field === "weightIntent")).toBe(true);
    expect(proposal.proposedSkills.some((s) => s.zone === "crown")).toBe(false);
    expect(proposal.reasoningStatus === "PARTIAL_PLAN" || proposal.reasoningStatus === "NEEDS_PROFESSIONAL_INPUT").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@professional-reasoning-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Professional Reasoning Service Client" } });
  return { ownerUserId, clientId };
}

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";
function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- step one.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- step two.", referencedParameters: [] },
  ];
}
function weightReducingSkill(): SkillDefinition {
  return {
    skillId: "synthetic.service-test.weight-reducer",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC -- Weight Reducer",
    description: SYNTHETIC,
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: SYNTHETIC,
    parameters: [],
    procedure: syntheticProcedure(),
    capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }],
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}
function asRecord(skill: SkillDefinition): ProfessionalSkillDefinitionRecord {
  return {
    id: `record-${skill.skillId}-v${skill.version}`,
    skillId: skill.skillId,
    version: skill.version,
    vertical: skill.vertical,
    name: skill.name,
    status: skill.status,
    authorityType: skill.authorityType,
    payload: skill,
    reviewedByUserId: null,
    reviewedAt: null,
    supersededBySkillDefinitionId: null,
    createdAt: skill.createdAt,
    updatedAt: skill.createdAt,
  };
}

// Builds a well-formed, validator-passing raw response for a given
// (current, target, registry) triple by importing the SAME deterministic
// selector/context builder the service itself uses, then authoring a
// minimal, honest proposal from the resulting candidate list -- this is
// the "mocked AI" for every test in this file: deterministic, never a
// real network call.
function buildRespondingProvider(
  input: { current: { id: string; snapshotVersion: number; payload: HairStateSnapshotPayload }; target: { id: string; snapshotVersion: number; payload: HairStateSnapshotPayload } },
  registry: readonly ProfessionalSkillDefinitionRecord[],
  name = "fake-deterministic",
): ProfessionalReasoningProvider {
  class RespondingProvider extends ProfessionalReasoningProvider {
    readonly name = name;
    readonly modelVersion = "fake-1.0";
    async reason(context: ProfessionalReasoningContext): Promise<ProfessionalReasoningProviderOutcome> {
      const proposedSkills = context.candidateSkills.map((c, i) => ({
        stepId: `step-${i + 1}`,
        skillDefinitionId: c.skillDefinitionId,
        skillKey: c.skillKey,
        skillVersion: c.skillVersion,
        zone: c.addressesDelta.scope,
        addressesDelta: c.addressesDelta,
        declaredCapabilityUsed: c.matchedCapability,
        parameters: [],
        rationale: `Addresses ${c.addressesDelta.field} at ${c.addressesDelta.scope} via ${c.matchedCapability}.`,
      }));
      const proposal: ProfessionalReasoningProposal = {
        schemaVersion: context.schemaVersion,
        planSummary: "Deterministic mocked plan using only real candidate skills.",
        proposedSkills,
        proposedOrder: proposedSkills.map((s) => s.stepId),
        preservationConstraints: context.preserveConstraints,
        unresolvedRequirements: context.unresolvedDeltas.map((e) => ({ scope: e.scope, field: e.field, reason: `No registered skill declares a capability for ${e.field} at ${e.scope}.` })),
        clarifyingQuestions: [],
        reasoningStatus: context.unresolvedDeltas.length > 0 ? "PARTIAL_PLAN" : "COMPLETE_CANDIDATE_PLAN",
      };
      return { rawProposal: proposal, providerRequestId: `fake-${randomUUID()}`, usage: { outputTokens: 64 } };
    }
  }
  return new RespondingProvider();
}
