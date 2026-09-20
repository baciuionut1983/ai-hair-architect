import { createHash } from "node:crypto";
import { PROFESSIONAL_VALUE_MAX_LENGTH, STRUCTURED_FIELD_SPECIFICATIONS, type StructuredProfessionalField } from "@/lib/structured-professional-field-claims";

// A declarative witness of the existing a-validator, not a new validator. Tests
// pin its implementation separately, so editing that implementation cannot leave
// this description silently out of sync. Canonical enums are never copied here.
const authoritativeTextSafety = Object.freeze({
  inputType: "string", minimumUtf16Length: 1, maximumUtf16Length: PROFESSIONAL_VALUE_MAX_LENGTH,
  nonWhitespaceRequired: true, whitespaceCheck: "ECMAScript String.trim length > 0; input unchanged",
  forbiddenPattern: String.raw`[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u2800\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]`,
  forbiddenPatternFlags: "u", membership: "Array.includes exact string identity",
});

export interface SemanticFieldSpecification {
  readonly field: string;
  readonly sourceExtractionField: string;
  readonly semanticCategory: string;
  readonly valueKind: string;
  readonly allowedValues: readonly string[];
  readonly normalization: string;
  readonly unknownRepresentable: boolean;
  readonly professionalCorrectionAllowed: boolean;
  readonly authoritativeTextSafety: Readonly<typeof authoritativeTextSafety>;
}
export interface VersionedFieldSpecification extends SemanticFieldSpecification { readonly specificationVersion: string }
export interface ProfessionalFieldSpecificationPin {
  readonly field: string;
  readonly specificationVersion: string;
  readonly specificationDigest: `sha256:${string}`;
}

export function getProfessionalFieldSpecification(field: StructuredProfessionalField): VersionedFieldSpecification {
  const spec = STRUCTURED_FIELD_SPECIFICATIONS[field];
  return Object.freeze({
    field: spec.field, sourceExtractionField: spec.sourceExtractionField, semanticCategory: spec.semanticCategory,
    valueKind: spec.valueKind, allowedValues: spec.allowedValues, normalization: spec.normalization,
    unknownRepresentable: spec.unknownRepresentable, professionalCorrectionAllowed: spec.professionalCorrectionAllowed,
    authoritativeTextSafety, specificationVersion: spec.version,
  });
}

// Private, deliberately independent of the observation-digest encoder: its
// canonicalization and payload must remain unchanged by this governance slice.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function pinProfessionalFieldSpecification(spec: VersionedFieldSpecification): ProfessionalFieldSpecificationPin {
  // Explicit semantic projection excludes version labels, comments, documentation
  // and runtime context. A test guards the source spec's full property inventory.
  const semantic: SemanticFieldSpecification = {
    field: spec.field, sourceExtractionField: spec.sourceExtractionField, semanticCategory: spec.semanticCategory,
    valueKind: spec.valueKind, allowedValues: spec.allowedValues, normalization: spec.normalization,
    unknownRepresentable: spec.unknownRepresentable, professionalCorrectionAllowed: spec.professionalCorrectionAllowed,
    authoritativeTextSafety: spec.authoritativeTextSafety,
  };
  return Object.freeze({ field: spec.field, specificationVersion: spec.specificationVersion,
    specificationDigest: `sha256:${createHash("sha256").update(canonicalJson(semantic), "utf8").digest("hex")}` });
}

export type SpecificationGoldens = Readonly<Record<string, Readonly<Record<string, `sha256:${string}`>>>>;
// Reviewed fixtures: never regenerated automatically during tests/build.
export const PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS: SpecificationGoldens = Object.freeze({
  "1.0.0-t162a": Object.freeze({
    elevation: "sha256:e203aae422ae2f7ebc54110cd6ac7de334572ebad38bd331b1d5ccf90c8b37ec",
    sectioning: "sha256:fd3e357561ac1d54088dec45a55b76966bb004df226ff578befba04ebeebebb1",
    guideType: "sha256:49ac4434ee357a3047bddcad88226fe31c3be5e6c5a0328618e68b8e54ee7a74",
  }),
});

// A pure comparison against an explicitly reviewed registry; no authority,
// persistence, current-draft lookup or global mutation is performed here.
export function matchesSpecificationGolden(pin: ProfessionalFieldSpecificationPin, goldens: SpecificationGoldens = PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS): boolean {
  return Object.hasOwn(goldens, pin.specificationVersion)
    && Object.hasOwn(goldens[pin.specificationVersion], pin.field)
    && goldens[pin.specificationVersion][pin.field] === pin.specificationDigest;
}
