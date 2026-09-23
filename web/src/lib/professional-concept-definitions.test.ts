import { describe, expect, it } from "vitest";
import historicalPack from "./__fixtures__/professional-concept-pack-1.1.0-t162c2a1.json";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK as pack } from "./professional-concept-cutting-pack";
import { conceptDigest, PROFESSIONAL_VALIDATION_REQUIRED, semanticFingerprint } from "./professional-concept-contracts";
import { canonicalValueDigest } from "./professional-canonical-value-contracts";
import { definitionDigest, isProfessionalDefinition } from "./professional-definition-contracts";
import { freezeProfessionalPack, isValidProfessionalConceptPack, type ProfessionalConceptPack } from "./professional-concept-registry";

const owners = ["elevation", "section", "subsection", "subsectioning", "parting", "projection", "overdirection", "guide"].map(n => `haircutting.${n}`);
const definition = (name: string) => pack.definitions.find(d => d.conceptId === `haircutting.${name}`)!;
const withoutVersions = (value: unknown) => JSON.parse(JSON.stringify(value), (key, v) => ["specificationVersion", "semanticVersion"].includes(key) ? undefined : v);

describe("O2 professionally supplied definitions", () => {
  it("populates exactly the eight authorized definition owners, keeping twelve concepts", () => {
    expect(pack.concepts).toHaveLength(12);
    expect(pack.definitions.map(d => d.conceptId)).toEqual(owners);
    expect(new Set(pack.definitions.map(d => d.definitionId)).size).toBe(8);
    expect(isValidProfessionalConceptPack(pack)).toBe(true);
    expect(pack.definitions.every(d => isProfessionalDefinition(d) && Object.isFrozen(d) && Object.isFrozen(d.provenance))).toBe(true);
  });
  it.each(["cuttingAngle", "cuttingLine", "sectioning", "guideType"])("does not define %s", name => {
    expect(definition(name)).toBeUndefined();
  });
  it("pins eight reviewed definition digests under the O2 version", () => {
    const goldens = { "1.2.0-t162c2b": {
      "haircutting.elevation": "sha256:7c7ddda22a2073fe744a02d902f11bcb572c1f11f1d0a22fde0e910d3d607ef3",
      "haircutting.section": "sha256:8fb9c7b975b4214ab26c9ac847aa89fdbdbc2b01f3261fffee0c5564d515fbe7",
      "haircutting.subsection": "sha256:dad9ce7950aaf0ac6bfce8b635911e00526e24646c794b3d2e8c28a48b20cb1c",
      "haircutting.subsectioning": "sha256:59a96847acf75e102587a038c2f980b6cb3a586c136165146d78a8add2022f79",
      "haircutting.parting": "sha256:7f3be54e550d7f450ecccd287b791a10ea9c3c4564180fbfccca8a9e16341865",
      "haircutting.projection": "sha256:fd23d8573a88abb096a985a83786b7d68e6409537531b0188a9460a77d6a72b9",
      "haircutting.overdirection": "sha256:2c6312d19b8182f473ec553947f19a527631f6f2d0895d97de6a8ee8a7cf25a2",
      "haircutting.guide": "sha256:5ed71bef479dafd8c9133cb1acd0a1fc3837ed37b0ee12b5258bd0f461a3b5fd",
    } };
    expect(pack.specificationVersion).toBe("1.2.0-t162c2b");
    expect(Object.fromEntries(pack.definitions.map(d => [d.conceptId, d.specificationDigest]))).toEqual(goldens["1.2.0-t162c2b"]);
    for (const d of pack.definitions) expect(definitionDigest(structuredClone(d))).toBe(d.specificationDigest);
  });
  it.each([
    ["elevation", "projection"], ["projection", "overdirection"], ["overdirection", "guide"],
    ["section", "subsection"], ["subsection", "subsectioning"], ["parting", "sectioning"],
    ["guide", "guideType"], ["elevation", "cuttingAngle"], ["elevation", "cuttingLine"],
  ])("keeps %s distinct from %s", (a, b) => {
    const first = definition(a); const second = definition(b);
    expect(first.conceptId).not.toBe(`haircutting.${b}`);
    if (second) expect(first.specificationDigest).not.toBe(second.specificationDigest);
    expect([...(first.distinguishFrom ?? []), ...(second?.distinguishFrom ?? [])]).toContain(second?.distinguishFrom?.includes(first.conceptId) ? first.conceptId : `haircutting.${b}`);
  });
  it("keeps mobility independent without inventing a mobility concept or behavior values", () => {
    expect(definition("overdirection").interpretationRequired).toContain("Guide mobility and overdirection are independent axes");
    expect(pack.concepts.some(c => /mobility|guideBehavior|partingDirection/i.test(c.conceptId))).toBe(false);
    expect(pack.canonicalValues).toHaveLength(14);
    expect(pack.canonicalValues.some(v => ["haircutting.guide", "haircutting.parting"].includes(v.conceptId))).toBe(false);
    for (const token of ["stationary", "traveling"]) {
      const v = pack.canonicalValues.find(v => v.valueToken === token)!;
      expect(v.conceptId).toBe("haircutting.guideType");
      expect(v.status).toBe("AMBIGUOUS");
      expect(v.legacyMappingCorrespondence?.[0].correspondence).toBe("PARTIAL");
    }
  });
  it("retains unknown scope/observability and adds no effects, roles, translations or relationships", () => {
    for (const d of pack.definitions) {
      expect(d.scope).toBe(PROFESSIONAL_VALIDATION_REQUIRED);
      for (const key of ["observability", "executionRole", "effectClaims", "localizedLabels", "sourceTerm"]) expect(d).not.toHaveProperty(key);
      expect(Object.keys(d).sort()).toEqual(["conceptId", "definitionId", "distinguishFrom", "provenance", "scope", "sourceLanguage", "specificationDigest", "specificationVersion", "text", ...(d.conceptId === "haircutting.overdirection" ? ["interpretationRequired"] : [])].sort());
    }
    expect(pack.concepts.every(c => c.scope === PROFESSIONAL_VALIDATION_REQUIRED && c.observability === PROFESSIONAL_VALIDATION_REQUIRED && !c.relationships?.length)).toBe(true);
  });
  it("records supplied confirmation as provenance only, without fabricated citations or author identity", () => {
    for (const d of pack.definitions) {
      expect(d.provenance).toEqual({ sourceId: "T1_6_2_C_2B_PROFESSIONALLY_VALIDATED_CANONICAL_DEFINITIONS#professional-input", authorityType: "CONFIRMED", reviewedAt: "2026-09-24" });
      expect(d.sourceLanguage).toBe("en");
      expect(d.text).not.toMatch(/Ionuț|https?:|45°|Interior/);
      expect(d.definitionId).toBe(`${d.conceptId}.definition`);
      expect(definitionDigest({ ...d, provenance: { ...d.provenance, authorId: "test-reviewer", sourceId: "another-source", reviewedAt: "2026-10-01" } })).toBe(d.specificationDigest);
    }
  });
  it("rejects stale semantic mutations while excluding presentation and version metadata", () => {
    for (const d of pack.definitions) {
      const changed = { ...d, text: `${d.text} Unapproved extra meaning.` };
      expect(definitionDigest(changed)).not.toBe(d.specificationDigest);
      expect(isValidProfessionalConceptPack({ ...pack, definitions: pack.definitions.map(item => item === d ? changed : item) })).toBe(false);
      expect(definitionDigest({ ...d, localizedLabels: { ro: "test-only translation" }, specificationVersion: "9.0.0" })).toBe(d.specificationDigest);
      expect(definitionDigest({ ...d, provenance: { ...d.provenance, authorityType: "UNKNOWN" } })).not.toBe(d.specificationDigest);
    }
  });
  it("keeps original concept/value semantics identical to released O1.1", () => {
    expect(withoutVersions(pack.concepts)).toEqual(withoutVersions(historicalPack.concepts));
    expect(withoutVersions(pack.canonicalValues)).toEqual(withoutVersions(historicalPack.canonicalValues));
    for (const c of pack.concepts) {
      expect(c.specificationVersion).toBe(pack.specificationVersion);
      expect(conceptDigest(c)).toBe(c.specificationDigest);
      for (const r of c.canonicalValues ?? []) expect(r.semanticVersion).toBe(pack.specificationVersion);
    }
    for (const v of pack.canonicalValues) {
      expect(v.semanticVersion).toBe(pack.specificationVersion);
      expect(canonicalValueDigest(v)).toBe(v.semanticDigest);
    }
    expect(pack.definitions.every(d => d.specificationVersion === pack.specificationVersion)).toBe(true);
  });
  it("reproduces historical O1 and O1.1 with their original labels and no definitions", () => {
    const o11 = freezeProfessionalPack(structuredClone(historicalPack) as ProfessionalConceptPack);
    expect(o11.specificationVersion).toBe("1.1.0-t162c2a1");
    expect(o11.definitions).toEqual([]);
    const o1 = JSON.parse(JSON.stringify({ ...o11, concepts: o11.concepts.slice(0, 5) }), (key, value) => ["specificationVersion", "semanticVersion"].includes(key) ? "1.0.0-t162c2a" : value);
    expect(isValidProfessionalConceptPack(o1)).toBe(true);
    expect(semanticFingerprint(withoutVersions({ concepts: o1.concepts, canonicalValues: o1.canonicalValues }))).toBe("sha256:d77ea89558c1d453d05057c6f79fe1bd5454121371d3ae955451aaa08d06dd17");
    expect(o1.definitions).toEqual([]);
  });
  it("does not globalize any private technique mechanics", () => {
    const semanticText = pack.definitions.map(d => [d.text, d.interpretationRequired].filter(Boolean).join(" ")).join("\n");
    expect(semanticText).not.toMatch(/45|Interior|vertical|diagonal|finger|rotation|upper|lower|inward|finishing|quadrant|horseshoe|ownerUserId|reviewedByUserId/);
    expect(pack.canonicalValues.every(v => v.semanticMeaning === PROFESSIONAL_VALIDATION_REQUIRED && !v.legacyAliases)).toBe(true);
  });
});
