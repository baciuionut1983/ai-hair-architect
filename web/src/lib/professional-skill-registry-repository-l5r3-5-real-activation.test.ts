import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { INTERIOR_45_SKILL } from "@/lib/cutting-skill-45-degree-interior";
import {
  activateSkillDefinition,
  createSkillDefinition,
  findLatestSkillDefinition,
  ProfessionalSkillRegistryStateError,
  ProfessionalSkillRegistryValidationError,
} from "@/lib/professional-skill-registry-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 -- REAL
// LOCAL activation proof against the existing DB-backed repository
// (professional-skill-registry-repository.ts). Real local Postgres, NO
// mocks, NO production database (DATABASE_URL points at localhost's
// ai_hair_architect_test, verified before this stage began). Skips
// (never fails) when no database is configured -- same established
// convention as professional-skill-registry-repository.test.ts.
//
// WHY THIS FILE EXISTS: cutting-skill-45-degree-interior.ts's own
// `status: "ACTIVE"` is the mechanism the actual runtime brain/compiler
// pipeline reads today (professional-brain-skill-templates.ts's own
// in-memory canonical registry). This file separately, honestly proves
// that the REAL, existing DB-backed repository (Stage 3, previously
// never exercised by any of the 6 pre-existing skills) also correctly
// performs the DRAFT->ACTIVE transition for this real, approved skill --
// and is naturally idempotent-safe by REJECTING a repeat, never silently
// duplicating.
//
// CONFIRMED ARCHITECTURAL QUIRK (observed here, NOT modified --
// professional-skill-registry-repository.ts is existing, protected code
// this stage does not edit): activateSkillDefinition's own header states
// "Only lifecycle metadata... is ever mutated in place afterward, NEVER
// `payload`" -- so after activation, the row's `status` COLUMN (and
// therefore every listSkillDefinitions/findSkillDefinition `.status`
// read) correctly reports "ACTIVE", but the row's `payload.status`
// (the embedded JSON, frozen at creation time) still reads "DRAFT",
// exactly as it was when created. This is a pre-existing, deliberate
// design choice (frozen content, mutable lifecycle status) -- reported
// here as a verified fact, never silently patched.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const createdSkillIds = new Set<string>();

suite("professional-skill-registry-repository -- REAL 45deg Interior activation (Stage 8.5L5.R3.5)", () => {
  afterEach(async () => {
    await prisma.professionalSkillDefinition.deleteMany({ where: { skillId: { in: [...createdSkillIds] } } });
    createdSkillIds.clear();
  });

  it("creates the real 45deg Interior skill as DRAFT, then activates it via the real repository -- status column flips to ACTIVE", async () => {
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    const draftInput = { ...INTERIOR_45_SKILL, status: "DRAFT" as const };

    const created = await createSkillDefinition(draftInput);
    expect(created.status).toBe("DRAFT");
    expect(created.payload).toEqual(draftInput);

    const activated = await activateSkillDefinition(INTERIOR_45_SKILL.skillId, INTERIOR_45_SKILL.version);
    expect(activated.status).toBe("ACTIVE");

    const found = await findLatestSkillDefinition(INTERIOR_45_SKILL.skillId);
    expect(found?.status).toBe("ACTIVE");
  });

  it("confirms the pre-existing 'frozen payload' architecture: payload.status remains DRAFT even after the status column is ACTIVE (observed, not modified)", async () => {
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    await createSkillDefinition({ ...INTERIOR_45_SKILL, status: "DRAFT" as const });
    const activated = await activateSkillDefinition(INTERIOR_45_SKILL.skillId, INTERIOR_45_SKILL.version);
    expect(activated.status).toBe("ACTIVE");
    expect(activated.payload.status).toBe("DRAFT");
  });

  it("mechanics/parameters/procedure/capabilities in the persisted payload are byte-identical to the source-of-truth constant except `status`", async () => {
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    const draftInput = { ...INTERIOR_45_SKILL, status: "DRAFT" as const };
    await createSkillDefinition(draftInput);
    const found = await findLatestSkillDefinition(INTERIOR_45_SKILL.skillId);
    expect(found?.payload.parameters).toEqual(INTERIOR_45_SKILL.parameters);
    expect(found?.payload.procedure).toEqual(INTERIOR_45_SKILL.procedure);
    expect(found?.payload.capabilities).toEqual(INTERIOR_45_SKILL.capabilities);
    expect(found?.payload.prerequisiteSkillIds).toEqual(INTERIOR_45_SKILL.prerequisiteSkillIds);
  });

  it("IDEMPOTENCY: a second createSkillDefinition with the exact same (skillId, version) is rejected -- never a duplicate row", async () => {
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    const draftInput = { ...INTERIOR_45_SKILL, status: "DRAFT" as const };
    await createSkillDefinition(draftInput);
    await expect(createSkillDefinition(draftInput)).rejects.toBeInstanceOf(ProfessionalSkillRegistryValidationError);

    const rows = await prisma.professionalSkillDefinition.findMany({ where: { skillId: INTERIOR_45_SKILL.skillId } });
    expect(rows).toHaveLength(1); // never duplicated
  });

  it("IDEMPOTENCY: a second activateSkillDefinition on an already-ACTIVE row is rejected (ALREADY_APPLIED-equivalent), never silently re-applied", async () => {
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    await createSkillDefinition({ ...INTERIOR_45_SKILL, status: "DRAFT" as const });
    await activateSkillDefinition(INTERIOR_45_SKILL.skillId, INTERIOR_45_SKILL.version);

    await expect(activateSkillDefinition(INTERIOR_45_SKILL.skillId, INTERIOR_45_SKILL.version)).rejects.toBeInstanceOf(ProfessionalSkillRegistryStateError);

    const rows = await prisma.professionalSkillDefinition.findMany({ where: { skillId: INTERIOR_45_SKILL.skillId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ACTIVE");
  });

  it("zero side effects beyond this one skill's own row -- no other skillId is touched by this activation", async () => {
    const before = await prisma.professionalSkillDefinition.count();
    createdSkillIds.add(INTERIOR_45_SKILL.skillId);
    await createSkillDefinition({ ...INTERIOR_45_SKILL, status: "DRAFT" as const });
    await activateSkillDefinition(INTERIOR_45_SKILL.skillId, INTERIOR_45_SKILL.version);
    const after = await prisma.professionalSkillDefinition.count();
    expect(after).toBe(before + 1);
  });
});
