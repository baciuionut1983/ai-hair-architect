import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import o2 from "./__fixtures__/professional-concept-pack-1.2.0-t162c2b.json";
import o11 from "./__fixtures__/professional-concept-pack-1.1.0-t162c2a1.json";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK as pack } from "./professional-concept-cutting-pack";
import { conceptDigest, LEGACY_MAPPING_CORRESPONDENCES, LEGACY_TOKEN_STATUSES, PROFESSIONAL_VALIDATION_REQUIRED } from "./professional-concept-contracts";
import { canonicalValueDigest } from "./professional-canonical-value-contracts";
import { definitionDigest } from "./professional-definition-contracts";
import { isValidProfessionalConceptPack, type ProfessionalConceptPack } from "./professional-concept-registry";
import { ELEVATION_OPTIONS, STRUCTURAL_TECHNIQUES } from "./proposal-validators";
import { validateProfessionalFieldValue } from "./structured-professional-field-claims";

const tokens = ["0_deg", "45_deg", "90_deg", "135_deg", "180_deg"];
const legacyTokens = ["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "135_deg_long_layer", "180_deg_overdirection"];
const elevation = pack.concepts[0];
const legacy = pack.canonicalValues.filter(v => legacyTokens.includes(v.valueToken));
const clean = pack.canonicalValues.filter(v => v.conceptId === "haircutting.elevation" && v.status === "CANONICAL");
const withoutVersions = (v: unknown) => JSON.parse(JSON.stringify(v), (k, x) => ["semanticVersion", "specificationVersion"].includes(k) ? undefined : x);
// Re-pin synthetic mutations so a failure proves status/reference enforcement,
// rather than just the already-proven stale-digest check.
function repin(p: ProfessionalConceptPack): ProfessionalConceptPack {
  const canonicalValues = p.canonicalValues.map(v => ({ ...v, semanticDigest: canonicalValueDigest(v) }));
  const concepts = p.concepts.map(c => {
    const next = { ...c, canonicalValues: c.canonicalValues?.map(r => {
      const v = canonicalValues.find(v => v.conceptId === r.conceptId && v.valueToken === r.valueToken);
      return v ? { ...r, semanticDigest: v.semanticDigest } : r;
    }) };
    return { ...next, specificationDigest: conceptDigest(next) };
  });
  return { ...p, concepts, canonicalValues };
}

describe("c.2c pure elevation values and governed status exceptions", () => {
  it("registers exactly five clean values after five historical values, with no new concept or definition", () => {
    expect(pack.specificationVersion).toBe("1.3.0-t162c2c");
    expect(pack.concepts).toHaveLength(12); expect(pack.definitions).toHaveLength(8); expect(pack.canonicalValues).toHaveLength(19);
    expect(clean.map(v => v.valueToken)).toEqual(tokens);
    expect(elevation.canonicalValues?.map(r => r.valueToken)).toEqual([...legacyTokens, ...tokens]);
    expect(pack.canonicalValues.slice(0, 10).map(v => v.valueToken)).toEqual([...legacyTokens, ...tokens]);
    expect(isValidProfessionalConceptPack(pack)).toBe(true);
    expect(elevation.status).toBe("AMBIGUOUS");
    expect(elevation.legacyMappings).toEqual(tokens.map(token => ({ token, classification: "CANONICAL" })));
  });
  it.each(tokens)("%s contains only angle identity and numeral presentation", token => {
    const v = clean.find(v => v.valueToken === token)!;
    expect(v).toEqual({ conceptId: "haircutting.elevation", valueToken: token,
      semanticMeaning: PROFESSIONAL_VALIDATION_REQUIRED, localizedLabels: { en: token.replace("_deg", "°") },
      semanticVersion: pack.specificationVersion, status: "CANONICAL", semanticDigest: canonicalValueDigest(v) });
    expect(v.valueToken + v.localizedLabels.en).not.toMatch(/blunt|one_length|graduation|uniform|layer|overdirection/);
    expect(Object.isFrozen(v)).toBe(true);
  });
  it.each(legacyTokens)("preserves %s and maps only its angle component", token => {
    const index = legacyTokens.indexOf(token); const v = legacy[index];
    expect(v.status).toBe("AMBIGUOUS");
    expect(v.legacyMappingCorrespondence).toEqual([{ targetModelRef: "haircutting.elevation", targetDimension: "AngleComponent", targetValue: tokens[index], correspondence: "PARTIAL" }]);
    expect(v.legacyAliases).toBeUndefined();
    const old = o2.canonicalValues.find(v => v.valueToken === token)!;
    const { legacyMappingCorrespondence: mapping, semanticDigest: digest, ...rest } = v;
    const { semanticDigest: oldDigest, ...oldRest } = old;
    expect(mapping).toHaveLength(1); expect(digest).not.toBe(oldDigest);
    expect(withoutVersions(rest)).toEqual(withoutVersions(oldRest));
  });
  it("pins new elevation and all ten elevation-value digests", () => {
    const goldens = {
      "0_deg_blunt": "sha256:1b6466ebe2aac6d758b00296ce401e018653899b804a6a6260f0a5fa2835e80b",
      "45_deg_graduation": "sha256:828cc984b5da5fe5368807db26e48b5e30379f40c72d781122a6a0c952a40ec6",
      "90_deg_uniform_layer": "sha256:ad61f82ccbdf39b83bc6a8992acaf7e3a229c4c395158f9b035b09db1a27f304",
      "135_deg_long_layer": "sha256:9c19cb795517b29ee4d4f85af1ef9bfa195b1851388e093571b3d6018b6f00f2",
      "180_deg_overdirection": "sha256:19ba0c4ade0486b832994e3b2f269966b37e9281f026928b73bbd829c5b77968",
      "0_deg": "sha256:e98798fa0f4fb43f342ed759de5d7acc5a20075913524401b835b010f05a8dee",
      "45_deg": "sha256:50062e9e9896ad234c27198a1efe0031bf4df1d5d17dddcc1bda5555d0b845b8",
      "90_deg": "sha256:fde40c649387d77f40ccd7f73e98d120ad4b02836de4e48dc6e6ba57ded257ad",
      "135_deg": "sha256:05851da67357251c6709879b069ade80934f7fb1026467d6606096279b3a0bcc",
      "180_deg": "sha256:d1909003ee2243610cdd4a9fd71c0c5c71e39f37c3ae1ecccd26cf7b273da7cb",
    };
    expect(elevation.specificationDigest).toBe("sha256:d5c1b8ed934d23c44e32b9e7c7d2f83c6f8874807587f584f6973a20f184fb71");
    expect(elevation.specificationDigest).not.toBe(o2.concepts[0].specificationDigest);
    expect(Object.fromEntries(pack.canonicalValues.slice(0, 10).map(v => [v.valueToken, v.semanticDigest]))).toEqual(goldens);
    for (const v of pack.canonicalValues) expect(canonicalValueDigest(structuredClone(v))).toBe(v.semanticDigest);
  });
  it("changes digest for semantic angle/target/correspondence/status changes, excluding presentation/version", () => {
    for (const v of clean) {
      expect(canonicalValueDigest({ ...v, valueToken: "999_deg" })).not.toBe(v.semanticDigest);
      expect(canonicalValueDigest({ ...v, status: "AMBIGUOUS" })).not.toBe(v.semanticDigest);
      expect(canonicalValueDigest({ ...v, localizedLabels: { en: "presentation only" }, semanticVersion: "9.0.0" })).toBe(v.semanticDigest);
    }
    const v = legacy[1]; const mapping = v.legacyMappingCorrespondence![0];
    for (const change of [{ targetValue: "90_deg" }, { correspondence: "EXACT" as const }, { note: "semantic note" }]) {
      const changed = { ...v, legacyMappingCorrespondence: [{ ...mapping, ...change }] };
      expect(canonicalValueDigest(changed)).not.toBe(v.semanticDigest);
      expect(isValidProfessionalConceptPack({ ...pack, canonicalValues: pack.canonicalValues.map(x => x === v ? changed : x) })).toBe(false);
    }
  });
  it("preserves the other eleven concepts, nine values and eight O2 definitions apart from version labels", () => {
    expect(withoutVersions(pack.concepts.slice(1))).toEqual(withoutVersions(o2.concepts.slice(1)));
    expect(withoutVersions(pack.canonicalValues.slice(10))).toEqual(withoutVersions(o2.canonicalValues.slice(5)));
    expect(withoutVersions(pack.definitions)).toEqual(withoutVersions(o2.definitions));
    for (const c of pack.concepts) {
      expect(c.specificationVersion).toBe(pack.specificationVersion);
      expect(conceptDigest(c)).toBe(c.specificationDigest);
      for (const r of c.canonicalValues ?? []) expect(r.semanticVersion).toBe(pack.specificationVersion);
    }
    for (const v of pack.canonicalValues) expect(v.semanticVersion).toBe(pack.specificationVersion);
    for (const d of pack.definitions) { expect(d.specificationVersion).toBe(pack.specificationVersion); expect(definitionDigest(d)).toBe(d.specificationDigest); }
  });
  it.each([o11, o2])("recomputes historical $specificationVersion without rewriting its digests", historical => {
    expect(isValidProfessionalConceptPack(historical)).toBe(true);
    for (const c of historical.concepts) expect(conceptDigest(c as typeof elevation)).toBe(c.specificationDigest);
    for (const v of historical.canonicalValues) expect(canonicalValueDigest(v as typeof legacy[number])).toBe(v.semanticDigest);
    for (const d of historical.definitions) expect(definitionDigest(d as typeof pack.definitions[number])).toBe(d.specificationDigest);
    expect(historical.concepts[0].legacyMappings).toEqual([]);
    expect(historical.canonicalValues).toHaveLength(14);
  });
  it("requires an explicit exact-token override on the owning concept; correspondence never substitutes", () => {
    for (const correspondence of LEGACY_MAPPING_CORRESPONDENCES) {
      const p = structuredClone(pack);
      p.concepts[0] = { ...p.concepts[0], legacyMappings: [] };
      p.canonicalValues[5] = { ...p.canonicalValues[5], legacyMappingCorrespondence: [{ targetModelRef: "haircutting.elevation", targetDimension: "AngleComponent", ...(correspondence === "NO_MAPPING" ? {} : { targetValue: "0_deg" }), correspondence }] };
      expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
    }
    const p = structuredClone(pack);
    p.concepts[0] = { ...p.concepts[0], legacyMappings: p.concepts[0].legacyMappings!.slice(1) };
    expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
  });
  it("rejects duplicate, missing-value and mismatched overrides after re-pinning", () => {
    for (const mappings of [
      [...elevation.legacyMappings!, elevation.legacyMappings![0]],
      [...elevation.legacyMappings!, { token: "missing", classification: "CANONICAL" as const }],
      elevation.legacyMappings!.map(m => ({ ...m, classification: "AMBIGUOUS" as const })),
    ]) {
      const p = structuredClone(pack); p.concepts[0] = { ...p.concepts[0], legacyMappings: mappings };
      expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
    }
    const p = structuredClone(pack); p.concepts[0] = { ...p.concepts[0], canonicalValues: p.concepts[0].canonicalValues!.slice(0, 9) };
    expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
  });
  it("cannot reuse elevation overrides for an unrelated concept or legacy token", () => {
    for (const conceptId of ["haircutting.sectioning", "haircutting.guideType"]) {
      const p = structuredClone(pack); const i = p.canonicalValues.findIndex(v => v.conceptId === conceptId);
      p.canonicalValues[i] = { ...p.canonicalValues[i], status: "CANONICAL" };
      expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
      const ci = p.concepts.findIndex(c => c.conceptId === conceptId);
      p.concepts[ci] = { ...p.concepts[ci], legacyMappings: elevation.legacyMappings };
      expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
    }
    const p = structuredClone(pack); p.canonicalValues[1] = { ...p.canonicalValues[1], status: "CANONICAL" };
    expect(isValidProfessionalConceptPack(repin(p))).toBe(false);
  });
  it.each(LEGACY_TOKEN_STATUSES)("retains historical uniform-status behavior without overrides for %s", status => {
    for (const candidate of LEGACY_TOKEN_STATUSES) {
      const p = structuredClone(o2) as typeof pack;
      p.concepts[0] = { ...p.concepts[0], status };
      p.canonicalValues = p.canonicalValues.map(v => v.conceptId === "haircutting.elevation" ? { ...v, status } : v);
      p.canonicalValues[0] = { ...p.canonicalValues[0], status: candidate };
      expect(isValidProfessionalConceptPack(repin(p))).toBe(candidate === status);
    }
  });
  it("keeps the supplied corrected-decision fixture compatible without rewriting it or creating a binding", () => {
    // Supplied read-only decision triple, not a DB read or a claimed copy of the complete row.
    const decision = Object.freeze({ field: "elevation", decision: "CORRECTED", professionalValue: "45_deg_graduation" });
    const before = JSON.stringify(decision);
    expect(validateProfessionalFieldValue(decision.field, decision.professionalValue)).toBe(true);
    expect(tokens.every(token => !validateProfessionalFieldValue("elevation", token))).toBe(true);
    const source = legacy.find(v => v.valueToken === decision.professionalValue)!;
    expect(source.status).toBe("AMBIGUOUS");
    expect(source.legacyMappingCorrespondence![0].correspondence).toBe("PARTIAL");
    expect(source.legacyMappingCorrespondence![0].targetValue).toBe("45_deg");
    expect(clean.find(v => v.valueToken === "45_deg")?.status).toBe("CANONICAL");
    expect(JSON.stringify(decision)).toBe(before);
  });
  it("preserves structural-technique vocabulary and all five angle/technique distinctions", () => {
    expect(ELEVATION_OPTIONS).toEqual(legacyTokens);
    expect(STRUCTURAL_TECHNIQUES).toEqual(["precision_layering", "graduation", "one_length", "internal_layering", "compact_graduation"]);
    for (const [token, other] of [["0_deg", "one_length"], ["45_deg", "graduation"], ["90_deg", "uniform_layer"], ["135_deg", "long_layer"], ["180_deg", "haircutting.overdirection"]]) {
      const v = clean.find(v => v.valueToken === token)!;
      expect(v.valueToken).not.toBe(other); expect(v.conceptId).toBe("haircutting.elevation");
      expect(v.legacyAliases).toBeUndefined(); expect(v.executionSemantics).toBeUndefined();
    }
    expect(pack.concepts.every(c => !c.relationships?.length)).toBe(true);
  });
  it("leaves protected Skill, TD, review/persistence, vocabulary and eligibility source unchanged", () => {
    const hashes = {
      "cutting-skill-45-degree-interior": "6876f3309311ffaaa3500bc6389ad90b3a4c68edebd596dbc11b97fab68104e9",
      "cutting-skill-graduated": "ba800f9d50ba0b1dde3edb209bf594c54ff595c7efc281925fa0428f951b4108",
      "cutting-skill-one-length-perimeter": "4e7b6b061b49b4234288490324251f26e9a15364ba60c45f5a49848278419220",
      "owner-knowledge-eligibility": "41ec66b7696d11dafefc5dc4921c843c18bca2e715a80bd01e676684b5aa9655",
      "technical-demonstration-cutting-contracts": "14110ef0636f4da37b6dc743c30244abb2a3151a0c8a598dd6ec96d5c681951a",
      "professional-field-claim-decision-service": "7cae8cd45dc39df968422f3a8c5fb0b74fbc6285e724fe15313babfd5a544dfc",
      "structured-professional-field-claims": "05bc514e5eb124403ce9d8435e955c1b28a429cc4c96b1873b300f7f26b343a1",
      "proposal-validators": "37fae4d063bbfb8090e9286b8c694b6ddee4d8f309d02739b751af485cde54e4",
    };
    for (const [name, hash] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(`src/lib/${name}.ts`, "utf8").replace(/\r\n/g, "\n")).digest("hex")).toBe(hash);
  });
});
