import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import { buildProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";
import type { SkillDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { GeminiProfessionalReasoningProvider, type GeminiReasoningGenerateClient, type GeminiReasoningGenerateInput } from "@/lib/professional-reasoning-provider-gemini";
import { validateProfessionalReasoningProposal } from "@/lib/professional-reasoning-validator";

// Professional Skill Engine, Stage 5.R1 -- the real Gemini adapter's OWN
// tests. ZERO real network calls anywhere in this file -- the low-level
// client is always a hand-built fake, exactly like
// orchestrator-ai-intent-provider-gemini.test.ts's own convention. This
// is the required zero-cost proof that the adapter's prompt/parse/coerce
// logic is correct BEFORE the one authorized real call is ever made.

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}
function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}
function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- step one.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- step two.", referencedParameters: [] },
  ];
}
function weightReducingSkill(): SkillDefinition {
  return {
    skillId: "synthetic.gemini-adapter-test.weight-reducer",
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

function buildContext() {
  const registry = [asRecord(weightReducingSkill())];
  const current = basePayload();
  const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
  const selection = selectCandidateSkillsForDelta({ id: "current-1", snapshotVersion: 1, payload: current }, { id: "target-1", snapshotVersion: 1, payload: target }, registry);
  return { context: buildProfessionalReasoningContext({ selection }), registry };
}

function fakeClient(responseText: string | undefined, capturedPrompts: string[] = []): GeminiReasoningGenerateClient {
  return {
    async generateContent(input: GeminiReasoningGenerateInput) {
      capturedPrompts.push(input.prompt);
      return responseText;
    },
  };
}

describe("GeminiProfessionalReasoningProvider (fake client, zero real network calls)", () => {
  it("constructor requires a real apiKey and model -- fails closed when misconfigured", () => {
    expect(() => new GeminiProfessionalReasoningProvider({ apiKey: "", model: "gemini-3.6-flash" })).toThrow();
    expect(() => new GeminiProfessionalReasoningProvider({ apiKey: "fake-key", model: "" })).toThrow();
  });

  it("the prompt includes every allowed candidate skill's exact id/key/version/capability, and never a free-text haircut name", () => {
    const { context } = buildContext();
    const prompts: string[] = [];
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(validGeminiJson(context), prompts));
    return provider.reason(context).then(() => {
      const prompt = prompts[0];
      expect(prompt).toContain(context.candidateSkills[0].skillDefinitionId);
      expect(prompt).toContain(context.candidateSkills[0].skillKey);
      expect(prompt).toContain("REDUCE_WEIGHT");
      expect(prompt).not.toMatch(/butterfly|bob-haircut|pixie-cut/i);
    });
  });

  it("parses a well-formed Gemini JSON response into a rawProposal that passes full deterministic validation", async () => {
    const { context, registry } = buildContext();
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(validGeminiJson(context)));
    const outcome = await provider.reason(context);
    const result = validateProfessionalReasoningProposal(outcome.rawProposal, context, registry);
    expect(result.valid).toBe(true);
  });

  it("coerces stringified parameter values deterministically and losslessly (\"true\"->boolean, \"45\"->number, else string)", async () => {
    const { context } = buildContext();
    const jsonWithParams = validGeminiJson(context, [
      { name: "overdirection", value: "true" },
      { name: "elevationDegrees", value: "45" },
      { name: "elevation", value: "0_deg_blunt" },
    ]);
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(jsonWithParams));
    const outcome = await provider.reason(context);
    const parameters = (outcome.rawProposal as { proposedSkills: { parameters: { name: string; value: unknown }[] }[] }).proposedSkills[0].parameters;
    expect(parameters).toEqual([
      { name: "overdirection", value: true },
      { name: "elevationDegrees", value: 45 },
      { name: "elevation", value: "0_deg_blunt" },
    ]);
  });

  it("throws INVALID_RESPONSE for an empty response -- never silently returns a fabricated proposal", async () => {
    const { context } = buildContext();
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(""));
    await expect(provider.reason(context)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("throws INVALID_RESPONSE for malformed JSON", async () => {
    const { context } = buildContext();
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient("{not valid json"));
    await expect(provider.reason(context)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("a malformed-but-syntactically-valid-JSON response (wrong shape) still parses, but is rejected by the deterministic validator, never by the adapter silently repairing it", async () => {
    const { context, registry } = buildContext();
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(JSON.stringify({ garbage: true })));
    const outcome = await provider.reason(context);
    const result = validateProfessionalReasoningProposal(outcome.rawProposal, context, registry);
    expect(result.valid).toBe(false);
  });

  it("an adversarial response inventing a nonexistent skill still parses through unmodified, and is rejected downstream by the validator (the adapter never filters/repairs content)", async () => {
    const { context, registry } = buildContext();
    const adversarial = JSON.parse(validGeminiJson(context));
    adversarial.proposedSkills[0].skillDefinitionId = "invented-butterfly-skill";
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key-for-test", model: "gemini-3.6-flash" }, fakeClient(JSON.stringify(adversarial)));
    const outcome = await provider.reason(context);
    expect((outcome.rawProposal as { proposedSkills: { skillDefinitionId: string }[] }).proposedSkills[0].skillDefinitionId).toBe("invented-butterfly-skill");
    const result = validateProfessionalReasoningProposal(outcome.rawProposal, context, registry);
    expect(result.valid).toBe(false);
  });
});

function validGeminiJson(context: ReturnType<typeof buildProfessionalReasoningContext>, parameters: { name: string; value: string }[] = []): string {
  const candidate = context.candidateSkills[0];
  return JSON.stringify({
    schemaVersion: context.schemaVersion,
    planSummary: "SYNTHETIC -- fake Gemini response for adapter testing.",
    proposedSkills: [
      {
        stepId: "step-1",
        skillDefinitionId: candidate.skillDefinitionId,
        skillKey: candidate.skillKey,
        skillVersion: candidate.skillVersion,
        zone: candidate.addressesDelta.scope,
        addressesDelta: candidate.addressesDelta,
        declaredCapabilityUsed: candidate.matchedCapability,
        parameters,
        rationale: "SYNTHETIC rationale.",
      },
    ],
    proposedOrder: ["step-1"],
    preservationConstraints: context.preserveConstraints,
    unresolvedRequirements: context.unresolvedDeltas.map((e) => ({ scope: e.scope, field: e.field, reason: "SYNTHETIC -- no capability." })),
    clarifyingQuestions: [],
    reasoningStatus: "COMPLETE_CANDIDATE_PLAN",
  });
}
