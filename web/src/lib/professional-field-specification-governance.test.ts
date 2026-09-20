import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { STRUCTURED_FIELD_SPECIFICATIONS, STRUCTURED_FIELD_SPEC_VERSION, isSafeProfessionalText } from "@/lib/structured-professional-field-claims";
import { getProfessionalFieldSpecification as getSpec, pinProfessionalFieldSpecification as pin, matchesSpecificationGolden as approved, PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS as goldens, type VersionedFieldSpecification } from "@/lib/professional-field-specification-governance";

// Governance witnesses complement the semantic goldens. They pin validator and
// digest implementation so a code-only semantic edit cannot evade the descriptor.
// Comments/trivia are excluded. Review these alongside any intentional semantic bump.
const IMPLEMENTATION_GOLDENS: Readonly<Record<string, { validator: string; encoder: string }>> = {
  "1.0.0-t162a": { validator: "34ba95cc721dbf299eac2de2fb98b1ff5b64e7316ac12bb4a73181704c3a3e30", encoder: "7d60bcb47c691897dd4e680f8ba961b4cfb45260b766f045a5d330cca08742b8" },
};
const validatorFunctions = ["specification", "isSafeProfessionalText", "isStructuredProfessionalField", "validateProfessionalFieldValue"];
const encoderFunctions = ["getProfessionalFieldSpecification", "canonicalJson", "pinProfessionalFieldSpecification"];
function implementationDigest(source: string, names: readonly string[]): string {
  const ast = ts.createSourceFile("witness.ts", source, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const functions = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && !!node.body && !!node.name && names.includes(node.name.text));
  expect(functions.map(node => node.name!.text).sort()).toEqual([...names].sort());
  return createHash("sha256").update(functions.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"), "utf8").digest("hex");
}
const source = (name: string) => readFileSync(path.resolve(`src/lib/${name}.ts`), "utf8");

describe("semantic specification governance", () => {
  it.each(["elevation", "sectioning", "guideType"] as const)("pins current %s with independently computed .NET SHA256 golden", field => {
    const spec = getSpec(field);
    const result = pin(spec);
    expect(result.specificationVersion).toBe(STRUCTURED_FIELD_SPECIFICATIONS[field].version);
    expect(result.specificationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.specificationDigest).toBe(goldens[spec.specificationVersion][field]);
    expect(approved(result)).toBe(true);
    expect(pin(structuredClone(spec))).toEqual(result);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.authoritativeTextSafety)).toBe(true);
  });
  it("covers every source property and every supported field, without enum duplication", () => {
    expect(Object.keys(goldens[STRUCTURED_FIELD_SPEC_VERSION]).sort()).toEqual(Object.keys(STRUCTURED_FIELD_SPECIFICATIONS).sort());
    for (const [field, values] of [["elevation", ELEVATION_OPTIONS], ["sectioning", SECTIONING_OPTIONS], ["guideType", GUIDELINE_OPTIONS]] as const) {
      expect(getSpec(field).allowedValues).toBe(STRUCTURED_FIELD_SPECIFICATIONS[field].allowedValues);
      expect(getSpec(field).allowedValues).toEqual(values);
      expect(Object.keys(STRUCTURED_FIELD_SPECIFICATIONS[field]).sort()).toEqual(["field", "sourceExtractionField", "semanticCategory", "version", "valueKind", "normalization", "unknownRepresentable", "professionalCorrectionAllowed", "allowedValues", "validate"].sort());
    }
  });
  it("is recursively insertion-order independent; excludes version, comments and unrelated runtime context", () => {
    const spec = getSpec("elevation");
    const reordered = { ...Object.fromEntries(Object.entries(spec).reverse()), authoritativeTextSafety: Object.fromEntries(Object.entries(spec.authoritativeTextSafety).reverse()) } as unknown as VersionedFieldSpecification;
    expect(pin(reordered)).toEqual(pin(spec));
    const changedLabel = { ...spec, specificationVersion: "future", comment: "documentation", fetchedAt: 123, ownerId: "ignored" };
    expect(pin(changedLabel).specificationDigest).toBe(pin(spec).specificationDigest);
    expect(approved(pin(changedLabel))).toBe(false);
  });
  it("preserves array order and exact canonical strings without modifying input", () => {
    const spec = getSpec("elevation");
    for (const values of [[...spec.allowedValues].reverse(), [...spec.allowedValues, "new"], spec.allowedValues.slice(1), spec.allowedValues.map(v => `${v} `), ["é"], ["e\u0301"]]) {
      const before = structuredClone(values);
      expect(pin({ ...spec, allowedValues: values }).specificationDigest).not.toBe(pin(spec).specificationDigest);
      expect(values).toEqual(before);
    }
    expect(pin({ ...spec, allowedValues: ["é"] }).specificationDigest).not.toBe(pin({ ...spec, allowedValues: ["e\u0301"] }).specificationDigest);
  });
  it.each(["field", "sourceExtractionField", "semanticCategory", "valueKind", "normalization", "unknownRepresentable", "professionalCorrectionAllowed"] as const)("fails governance for same-version semantic drift in %s", key => {
    const spec = getSpec("elevation");
    const modified = { ...spec, [key]: typeof spec[key] === "boolean" ? !spec[key] : "changed" };
    const result = pin(modified);
    expect(result.specificationDigest).not.toBe(pin(spec).specificationDigest);
    expect(approved(result)).toBe(false);
  });
  it.each(["inputType", "minimumUtf16Length", "maximumUtf16Length", "nonWhitespaceRequired", "whitespaceCheck", "forbiddenPattern", "forbiddenPatternFlags", "membership"] as const)("pins authoritative text-safety %s", key => {
    const spec = getSpec("elevation");
    const policy = { ...spec.authoritativeTextSafety, [key]: "changed" } as unknown as VersionedFieldSpecification["authoritativeTextSafety"];
    expect(approved(pin({ ...spec, authoritativeTextSafety: policy }))).toBe(false);
  });
  it("requires an approved field/version golden and supports intentional future version plus reviewed golden", () => {
    const current = pin(getSpec("elevation"));
    expect(approved(current, {})).toBe(false);
    expect(approved(current, { [current.specificationVersion]: {} })).toBe(false);
    expect(approved({ ...current, field: "__proto__" })).toBe(false);
    const changed = pin({ ...getSpec("elevation"), professionalCorrectionAllowed: false, specificationVersion: "review-fixture-v2" });
    expect(approved(changed)).toBe(false);
    // Independent fixed .NET vector; no runtime-generated expected digest.
    expect(approved(changed, { "review-fixture-v2": { elevation: "sha256:4d6633f6ab7b4ac031cc6e6370db764198c0b1520ab3859898029f8eb92f3e01" } })).toBe(true);
  });
  it("pins actual validator and canonicalizer code for the declared version", () => {
    const witness = IMPLEMENTATION_GOLDENS[STRUCTURED_FIELD_SPEC_VERSION];
    expect(witness).toBeDefined();
    expect(implementationDigest(source("structured-professional-field-claims"), validatorFunctions)).toBe(witness.validator);
    expect(implementationDigest(source("professional-field-specification-governance"), encoderFunctions)).toBe(witness.encoder);
  });
  it("detects code-only validator drift while ignoring comments and formatting", () => {
    const original = source("structured-professional-field-claims");
    const baseline = implementationDigest(original, validatorFunctions);
    expect(implementationDigest(original.replace('value.length === 0', 'value.length === 1'), validatorFunctions)).not.toBe(baseline);
    expect(implementationDigest(original.replace('return value.trim()', '/* documentation only */\n  return value.trim()'), validatorFunctions)).toBe(baseline);
    const encoder = source("professional-field-specification-governance");
    expect(implementationDigest(encoder.replace('.sort()', '.reverse()'), encoderFunctions)).not.toBe(implementationDigest(encoder, encoderFunctions));
  });
  it("ties the safety descriptor to the real regex and authoritative max-length implementation", () => {
    const ast = ts.createSourceFile("claims.ts", source("structured-professional-field-claims"), ts.ScriptTarget.Latest, true);
    const safety = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isSafeProfessionalText")!;
    const regexes: string[] = [];
    const visit = (node: ts.Node) => { if (ts.isRegularExpressionLiteral(node)) regexes.push(node.text); ts.forEachChild(node, visit); };
    visit(safety);
    const policy = getSpec("elevation").authoritativeTextSafety;
    expect(regexes).toEqual([`/${policy.forbiddenPattern}/${policy.forbiddenPatternFlags}`]);
    expect(isSafeProfessionalText("x".repeat(policy.maximumUtf16Length))).toBe(true);
    expect(isSafeProfessionalText("x".repeat(policy.maximumUtf16Length + 1))).toBe(false);
    expect(isSafeProfessionalText("")).toBe(false);
    expect(isSafeProfessionalText("   ")).toBe(false);
  });
});
