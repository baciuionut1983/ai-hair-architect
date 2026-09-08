import { describe, expect, it } from "vitest";

import { isSkillEligibleForAuthority, isValidSkillDefinition } from "@/lib/professional-skill-contracts";
import { isSkillInstanceEligibleForAuthority, isValidSkillInstance, isValidSkillInstanceSequence } from "@/lib/professional-skill-instance-contracts";
import { isValidExecutionUnit, isValidExecutionUnitSequence } from "@/lib/professional-skill-execution-unit-contracts";
import * as atomicActionModule from "@/lib/professional-skill-atomic-action-contracts";
import * as skillContractsModule from "@/lib/professional-skill-contracts";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";

// ===========================================================================
// SECTION A -- REAL PROFESSIONAL AUTHORITY FIXTURE / CONSTANT.
// Every assertion in this section exercises the ACTUAL exported,
// professionally-authored Skill/Instance/Execution Unit content for
// "Establish Central Nape Guide" -- NOT a synthetic placeholder. See
// cutting-skill-establish-central-nape-guide.ts's own header comment for
// the full authority/provenance/scope reasoning.
// ===========================================================================

describe("A. REAL: Establish Central Nape Guide -- Skill Definition", () => {
  it("1. the real Skill Definition validates against the Stage 2.5.i.1 contract", () => {
    expect(isValidSkillDefinition(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL, isEstablishCentralNapeGuideFact)).toBe(true);
  });

  it("2. authority is professional/authored, ACTIVE, and eligible -- structurally distinct from an AI draft", () => {
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.authorityType).toBe("PROFESSIONALLY_AUTHORED");
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.status).toBe("ACTIVE");
    expect(isSkillEligibleForAuthority(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL)).toBe(true);
  });

  it("3. the procedure is a genuine, ordered, meaningful professional sequence -- not inflated, not microscopic", () => {
    const orders = ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.procedure.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4]);
    for (const step of ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.procedure) {
      expect(step.instruction.length).toBeGreaterThan(20);
      expect(step.referencedParameters?.length ?? 0).toBeGreaterThan(0);
    }
    // Every declared parameter is referenced by at least one real step --
    // no orphaned, unused authority.
    const referenced = new Set(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.procedure.flatMap((s) => s.referencedParameters ?? []));
    for (const parameter of ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters) {
      expect(referenced.has(parameter.name)).toBe(true);
    }
  });
});

describe("A. REAL: Establish Central Nape Guide -- Skill Instance", () => {
  it("4. the real Skill Instance validates against the Stage 2.5.i.5 contract", () => {
    expect(isValidSkillInstance(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, isEstablishCentralNapeGuideFact)).toBe(true);
    expect(isValidSkillInstanceSequence([ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE])).toBe(true);
  });

  it("5. every material bound value carries structured provenance -- FIXED_FROM_AUTHORITY + sourceReference, never a bare value", () => {
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.length).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.length);
    for (const binding of ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings) {
      expect(binding.bindingState).toBe("FIXED_FROM_AUTHORITY");
      expect(binding.value).not.toBeUndefined();
      expect(binding.sourceReference).toBeTruthy();
    }
  });

  function findBinding(name: string) {
    return ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.find((b) => b.parameterName === name);
  }

  it("6. the center-of-nape fixed starting point is represented, with no exception", () => {
    const binding = findBinding("startingZone");
    expect(binding?.value).toBe("center_nape");
    const parameter = ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.find((p) => p.name === "startingZone");
    expect(parameter?.allowedValues).toEqual(["center_nape"]);
  });

  it("7. the head-tilted-forward/down execution context is represented", () => {
    expect(findBinding("clientHeadPosition")?.value).toBe("tilted_forward_down");
  });

  it("8. zero-degree elevation is represented as its own distinct parameter, reusing the real ELEVATION_OPTIONS value", () => {
    expect(findBinding("elevation")?.value).toBe("0_deg_blunt");
  });

  it("9. the straight cutting-line shape is represented as its own distinct parameter, never a synonym of elevation", () => {
    const elevation = findBinding("elevation");
    const cuttingLine = findBinding("cuttingLineShape");
    expect(cuttingLine?.value).toBe("straight");
    expect(elevation?.parameterName).not.toBe(cuttingLine?.parameterName);
    expect(elevation?.value).not.toBe(cuttingLine?.value);
  });

  it("10. horizontal shear orientation is represented, distinct from elevation, cutting-line shape, and strand direction", () => {
    const shearOrientation = findBinding("shearOrientation");
    const elevation = findBinding("elevation");
    const cuttingLine = findBinding("cuttingLineShape");
    const distribution = findBinding("distribution");
    expect(shearOrientation?.value).toBe("horizontal");
    const names = [shearOrientation, elevation, cuttingLine, distribution].map((b) => b?.parameterName);
    expect(new Set(names).size).toBe(4);
  });

  it("11. the straight-shear tool is represented", () => {
    expect(findBinding("tool")?.value).toBe("straight_shear");
  });

  it("12. comb control method (not finger) is represented for the lower/nape area", () => {
    const parameter = ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.find((p) => p.name === "controlMethod");
    expect(findBinding("controlMethod")?.value).toBe("comb");
    expect(parameter?.allowedValues).toEqual(["comb"]);
  });

  it("13. wet-hair execution state is represented via a correctly-named, dedicated parameter -- not forced into an unrelated field", () => {
    expect(findBinding("hairState")?.value).toBe("wet");
    // Never overloaded onto an unrelated field such as clientHeadPosition
    // or guideStrandDirection.
    expect(findBinding("clientHeadPosition")?.value).not.toBe("wet");
    expect(findBinding("guideStrandDirection")?.value).not.toBe("wet");
  });

  it("strand direction (distribution: natural fall) and structural/cutting technique reuse the real, existing enum values", () => {
    expect(findBinding("distribution")?.value).toBe("natural_fall");
    expect(findBinding("structuralTechnique")?.value).toBe("one_length");
    expect(findBinding("cuttingTechnique")?.value).toBe("blunt_line");
  });
});

describe("A. REAL: Establish Central Nape Guide -- scope discipline", () => {
  // Checks TECHNICAL TRUTH only (parameter names, parameter allowed
  // values, bound values, zone id) -- never `rationale`/`description`
  // prose. Prose is expected and correct to mention "laterals are a
  // separate, not-yet-authored Skill" as an explicit scope-boundary
  // statement (see the source file's own header comment and this Skill's
  // own `rationale`); that is presentation narrative, not a lateral
  // execution RULE, and must never be conflated with structured technical
  // authority -- exactly the "NO FREE-TEXT AUTHORITY" principle this
  // stage itself requires. The Execution Unit's own `laterality` field
  // (a legitimate Stage 2.5.i.3 contract field name) is checked directly
  // by VALUE below, not via substring search.
  const structuralHaystack = JSON.stringify({
    parameterNames: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.map((p) => p.name),
    parameterAllowedValues: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.parameters.flatMap((p) => p.allowedValues ?? []),
    bindingValues: ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.map((b) => b.value),
    zoneId: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].zoneId,
    verticalPayload: ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].verticalPayload,
  }).toLowerCase();
  const haystack = structuralHaystack;

  it("14. contains no lateral professional execution rule in any structured (technical-truth) field", () => {
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0].laterality).toBe("NOT_APPLICABLE");
    expect(structuralHaystack.includes("lateral")).toBe(false);
  });

  it("15. contains no Slice And Slide / texturizing content", () => {
    expect(haystack.includes("slice_and_slide")).toBe(false);
    expect(haystack.includes("texturiz")).toBe(false);
  });

  it("16. contains no fringe content", () => {
    expect(haystack.includes("fringe")).toBe(false);
  });

  it("17. invents no unsupported client hair facts (density, texture, porosity, fiber thickness)", () => {
    for (const term of ["density", "texture", "porosity", "fiber_thickness", "fiber thickness"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });
});

describe("A. REAL: Establish Central Nape Guide -- Execution Unit", () => {
  it("18. the Execution Unit count (exactly one) is architecturally justified -- no fact varies within this Skill's own scope", () => {
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS.length).toBe(1);
    expect(isValidExecutionUnit(ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], isEstablishCentralNapeGuideFact)).toBe(true);
    expect(isValidExecutionUnitSequence(ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS)).toBe(true);
  });

  it("19. the Execution Unit traces back to the exact Skill Instance via the proper typed field (Stage 2.5.i.6a) -- no verticalPayload workaround remains", () => {
    const eu = ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0];
    expect(eu.sourceSkillInstanceId).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.skillInstanceId);
    expect(eu.verticalPayload).toBeUndefined();
    // The full chain remains reconstructible transitively: EU -> Instance
    // -> Definition/version, never duplicated on the Execution Unit itself.
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.sourceSkillId).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId);
    expect(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.sourceSkillVersion).toBe(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.version);
  });

  it("future Atomic Action compile readiness: every non-fixed-scope fact needed to compile this Skill's Execution Unit is present, structured, and provenance-tagged", () => {
    // A future deterministic compiler, given this Skill Instance + this
    // Execution Unit together, would find every technical fact it needs
    // (zone, head position, hair state, guide direction, elevation,
    // control method, distribution, structural/cutting technique,
    // cutting-line shape, shear orientation, tool) already resolved with
    // FIXED_FROM_AUTHORITY provenance -- zero UNRESOLVED bindings, zero
    // invented facts required.
    const unresolved = ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.filter((b) => b.bindingState === "UNRESOLVED");
    expect(unresolved).toEqual([]);
  });
});

describe("A. REAL: no Atomic Action generation, no runtime wiring", () => {
  it("20. no Atomic Actions are generated or persisted by this pilot", () => {
    // This file never imports isValidAtomicAction/AtomicAction, and the
    // pilot's own exports carry only Skill/Instance/Execution Unit
    // content -- confirmed by inspecting the Atomic Action module's own
    // export surface remains untouched (not re-exported, not extended).
    expect(Object.keys(atomicActionModule)).not.toContain("ESTABLISH_CENTRAL_NAPE_GUIDE_ATOMIC_ACTIONS");
  });

  it("21. introduces no runtime behavior -- the Skill Definition contract module exposes no new evaluator/compose/readiness export", () => {
    const exported = Object.keys(skillContractsModule);
    expect(exported).not.toContain("composeSkillInstances");
    expect(exported).not.toContain("evaluatePlanReadiness");
    expect(exported).not.toContain("evaluatePlanCoherence");
  });
});

// ===========================================================================
// SECTION B -- SYNTHETIC TEST CASES used only to validate failure paths.
// These deliberately mangle a COPY of the real content to prove the
// contracts' own validators still reject malformed data -- none of the
// values introduced here are professional authority.
// ===========================================================================

describe("B. SYNTHETIC failure-path checks (not real professional authority)", () => {
  it("rejects a mangled copy of the real Skill Instance missing required provenance on a FIXED_FROM_AUTHORITY binding", () => {
    const mangled = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      parameterBindings: [{ parameterName: "startingZone", bindingState: "FIXED_FROM_AUTHORITY" }, ...ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE.parameterBindings.slice(1)],
    };
    expect(isValidSkillInstance(mangled, isEstablishCentralNapeGuideFact)).toBe(false);
  });

  it("rejects a synthetic second Execution Unit from a different source Skill Instance mixed into this pilot's sequence", () => {
    const foreignUnit = {
      ...ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      executionUnitId: "executionunit-synthetic-foreign",
      order: 2,
      sourceSkillInstanceId: "skillinstance-synthetic-unrelated",
    };
    expect(isValidExecutionUnitSequence([ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], foreignUnit as never])).toBe(false);
  });

  it("rejects a synthetic Skill Instance whose source Skill is MACHINE_DRAFTED as ineligible authority, unlike the real one", () => {
    expect(isSkillInstanceEligibleForAuthority({ status: "DRAFT", authorityType: "MACHINE_DRAFTED" })).toBe(false);
    expect(isSkillInstanceEligibleForAuthority(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL)).toBe(true);
  });
});
