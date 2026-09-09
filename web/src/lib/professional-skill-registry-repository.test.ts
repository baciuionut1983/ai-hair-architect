import { readFileSync } from "fs";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { SkillDefinition, SkillParameterDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL } from "@/lib/cutting-skill-establish-central-nape-guide";
import { OCCIPITAL_TRANSITION_SKILL } from "@/lib/cutting-skill-occipital-transition";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import {
  activateSkillDefinition,
  createSkillDefinition,
  findLatestSkillDefinition,
  findSkillDefinition,
  listSkillDefinitions,
  ProfessionalSkillRegistryValidationError,
  retireSkillDefinition,
  toSkillDefinitionForCompiler,
} from "@/lib/professional-skill-registry-repository";
import * as registryModule from "@/lib/professional-skill-registry-repository";

// Professional Skill Engine, Stage 3 -- PROFESSIONAL SKILL REGISTRY
// FOUNDATION, real Postgres, no mocks. Mirrors hair-state-snapshot-
// repository.test.ts's own conventions. Every synthetic fixture below is
// DELIBERATELY labeled as such -- no real professional skill content is
// invented here (the 3 REAL skills used for test 14/15 are imported
// verbatim from their own already-shipped, already-authorized files).
// Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const createdSkillIds = new Set<string>();

suite("professional-skill-registry-repository (real Postgres)", () => {
  afterEach(async () => {
    await prisma.professionalSkillDefinition.deleteMany({ where: { skillId: { in: [...createdSkillIds] } } });
    createdSkillIds.clear();
  });

  // 11. persisted skill definition round-trip
  it("11. a persisted skill definition round-trips its full payload byte-for-byte", async () => {
    const skill = syntheticSkill({ skillId: uniqueSkillId("roundtrip") });
    const created = await createSkillDefinition(skill);
    const found = await findSkillDefinition(skill.skillId, 1);
    expect(found?.payload).toEqual(skill);
    expect(created.payload).toEqual(skill);
  });

  // 12. stable key/version uniqueness
  it("12. (skillId, version) is globally unique -- a duplicate version is rejected, a new version is not", async () => {
    const skillId = uniqueSkillId("uniqueness");
    await createSkillDefinition(syntheticSkill({ skillId, version: 1 }));
    await expect(createSkillDefinition(syntheticSkill({ skillId, version: 1 }))).rejects.toBeInstanceOf(ProfessionalSkillRegistryValidationError);
    await expect(createSkillDefinition(syntheticSkill({ skillId, version: 2 }))).resolves.toBeTruthy();
  });

  // 13. old skill version remains retrievable after a newer version exists
  it("13. an old, RETIRED skill version stays byte-identically retrievable after its successor is created", async () => {
    const skillId = uniqueSkillId("versioning");
    await createSkillDefinition(syntheticSkill({ skillId, version: 1, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" }));
    const v2 = syntheticSkill({ skillId, version: 2, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    await createSkillDefinition(v2);
    await retireSkillDefinition(skillId, 1, { skillId, version: 2 });

    const oldVersion = await findSkillDefinition(skillId, 1);
    expect(oldVersion?.status).toBe("RETIRED");
    expect(oldVersion?.supersededBySkillDefinitionId).not.toBeNull();
    // The RETIRED row's own CONTENT (name/parameters/procedure) is
    // byte-identical to what was originally authored -- only lifecycle
    // metadata changed.
    expect(oldVersion?.payload.parameters).toEqual(syntheticSkill({ skillId, version: 1 }).parameters);
    expect(oldVersion?.payload.procedure).toEqual(syntheticSkill({ skillId, version: 1 }).procedure);

    const latest = await findLatestSkillDefinition(skillId);
    expect(latest?.version).toBe(2);
  });

  // 14. the existing 3 proven skills can be represented without semantic loss
  it("14. the 3 real, already-authored Skills (Establish Central Nape Guide, Occipital Transition, Continue Central Nape Construction) persist without semantic loss", async () => {
    for (const real of [ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL, OCCIPITAL_TRANSITION_SKILL, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL]) {
      createdSkillIds.add(real.skillId);
      await createSkillDefinition(real);
      const found = await findSkillDefinition(real.skillId, real.version);
      expect(found?.payload).toEqual(real);
    }
  });

  // 15. persisted skill maps deterministically into the existing compiler path
  it("15. toSkillDefinitionForCompiler is a direct, lossless unwrap -- the exact object the existing SkillInstance chain already expects", async () => {
    createdSkillIds.add(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId);
    await createSkillDefinition(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL);
    const found = await findSkillDefinition(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId, ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version);
    const forCompiler = toSkillDefinitionForCompiler(found!);
    expect(forCompiler).toEqual(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL);
    // A SkillInstance's real, existing field shape (sourceSkillId/
    // sourceSkillVersion) resolves directly from the unwrapped object --
    // no adapter, no translation.
    expect({ sourceSkillId: forCompiler.skillId, sourceSkillVersion: forCompiler.version }).toEqual({
      sourceSkillId: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId,
      sourceSkillVersion: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version,
    });
  });

  // 16. invalid controlled vocabulary fails closed
  it("16. an ACTIVE + MACHINE_DRAFTED combination (invalid per the existing contract) fails closed, never silently coerced", async () => {
    const skill = syntheticSkill({ skillId: uniqueSkillId("invalid-vocab"), status: "ACTIVE", authorityType: "MACHINE_DRAFTED" });
    await expect(createSkillDefinition(skill)).rejects.toBeInstanceOf(ProfessionalSkillRegistryValidationError);
  });

  it("16b. an unrecognized status string fails closed", async () => {
    const skill = { ...syntheticSkill({ skillId: uniqueSkillId("invalid-status") }), status: "PUBLISHED" };
    await expect(createSkillDefinition(skill)).rejects.toBeInstanceOf(ProfessionalSkillRegistryValidationError);
  });

  // 17. unsupported/invalid domain fails closed
  it("17. an unsupported vertical (e.g. 'color', not yet a registry vertical) fails closed", async () => {
    const skill = syntheticSkill({ skillId: uniqueSkillId("unsupported-vertical"), vertical: "color" });
    await expect(createSkillDefinition(skill)).rejects.toBeInstanceOf(ProfessionalSkillRegistryValidationError);
  });

  // 18. no haircut-template abstraction introduced
  it("18. the registry module exports no haircut-template/goal abstraction (Butterfly/Bob/Pixie/WolfCut or generic 'template')", () => {
    const exportNames = Object.keys(registryModule);
    expect(exportNames.some((name) => /butterfly|bob|pixie|wolfcut|haircuttemplate|^template/i.test(name))).toBe(false);

    const sourceText = readFileSync(join(process.cwd(), "src", "lib", "professional-skill-registry-repository.ts"), "utf8");
    expect(/butterfly|pixie|wolfcut|bobskill/i.test(sourceText)).toBe(false);
  });

  // 19. registry query can filter by domain/status/version
  it("19. listSkillDefinitions filters by vertical/status/skillId; findLatestSkillDefinition filters by status", async () => {
    const skillIdA = uniqueSkillId("filter-a");
    const skillIdB = uniqueSkillId("filter-b");
    await createSkillDefinition(syntheticSkill({ skillId: skillIdA, version: 1, status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" }));
    await activateSkillDefinition(skillIdA, 1);
    await createSkillDefinition(syntheticSkill({ skillId: skillIdB, version: 1, status: "DRAFT", authorityType: "MACHINE_DRAFTED" }));

    const activeOnly = await listSkillDefinitions({ vertical: "cutting", status: "ACTIVE" });
    expect(activeOnly.some((r) => r.skillId === skillIdA)).toBe(true);
    expect(activeOnly.some((r) => r.skillId === skillIdB)).toBe(false);

    const draftOnly = await listSkillDefinitions({ status: "DRAFT", skillId: skillIdB });
    expect(draftOnly.map((r) => r.skillId)).toEqual([skillIdB]);

    const latestActive = await findLatestSkillDefinition(skillIdA, "ACTIVE");
    expect(latestActive?.version).toBe(1);
    const latestDraftForActivated = await findLatestSkillDefinition(skillIdA, "DRAFT");
    expect(latestDraftForActivated).toBeNull();
  });

  // 20. registry requires no AI call to retrieve/validate
  it("20. the registry module imports no AI/vision/video provider client -- retrieval and validation are pure DB + deterministic code", () => {
    const sourceText = readFileSync(join(process.cwd(), "src", "lib", "professional-skill-registry-repository.ts"), "utf8");
    expect(/gemini|openai|anthropic|veo-|claude-api|@google\/generative-ai/i.test(sourceText)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixtures -- DELIBERATELY SYNTHETIC, not real professional rule content
// (mirrors professional-skill-contracts.test.ts's own labeling exactly).
// ---------------------------------------------------------------------------

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";
let syntheticCounter = 0;

function uniqueSkillId(label: string): string {
  syntheticCounter += 1;
  const skillId = `synthetic.skill.registry-test.${label}.${Date.now()}.${syntheticCounter}`;
  createdSkillIds.add(skillId);
  return skillId;
}

function syntheticParameter(): SkillParameterDefinition {
  return { name: "syntheticToolOrientation", valueKind: "enum", allowedValues: ["synthetic-horizontal", "synthetic-vertical"], description: SYNTHETIC };
}

function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- incline client head forward.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- comb hair thoroughly downward while wet.", referencedParameters: [] },
  ];
}

function syntheticSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    skillId: "synthetic.skill.registry-default",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC TEST FIXTURE -- Registry test skill",
    description: SYNTHETIC,
    status: "DRAFT",
    authorityType: "MACHINE_DRAFTED",
    rationale: SYNTHETIC,
    parameters: [syntheticParameter()],
    procedure: syntheticProcedure(),
    createdAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}
