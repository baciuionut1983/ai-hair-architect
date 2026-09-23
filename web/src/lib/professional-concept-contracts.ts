import { createHash } from "node:crypto";
import { isHeadZone, type HeadZone } from "@/lib/technical-visual-map-validators";

// O1 is an inert structural vocabulary. None of these records grants authority.
export const PROFESSIONAL_VALIDATION_REQUIRED = "[NEEDS PROFESSIONAL VALIDATION]" as const;
export const PROFESSIONAL_CONCEPT_SPEC_VERSION = "1.1.0-t162c2a1";
export const PROFESSIONAL_SCOPES = ["TECHNIQUE_GLOBAL", "HEAD_REGION", "SECTION", "SUBSECTION", "STRAND", "ACTION", "PHASE", "OBSERVATION_WINDOW"] as const;
export const OBSERVABILITY_CLASSES = ["DIRECTLY_OBSERVABLE", "PARTIALLY_OBSERVABLE", "VOICE_OR_TEXT_EXPLAINABLE", "PROFESSIONAL_INTERPRETATION_REQUIRED", "NOT_RELIABLY_VISUAL"] as const;
export const OBSERVABILITY_CHANNELS = ["VISUAL", "AUDIO", "BOTH", "TEXT"] as const;
export const EXECUTABILITY_ROLES = ["DESCRIPTIVE", "STATE", "PARAMETER", "CONSTRAINT", "ACTION", "CONTROL_FLOW", "EFFECT", "CONTEXT"] as const;
// L lists 13 rows; two rows contain inverse pairs, hence 15 identifiers.
export const PROFESSIONAL_RELATIONSHIP_KINDS = ["PART_OF", "CONTAINS", "APPLIES_TO", "PRECEDES", "FOLLOWS", "CONSTRAINS", "REQUIRES", "MODIFIES", "PRODUCES_EFFECT", "USES_GUIDE", "USES_TOOL", "OBSERVED_AS", "EXECUTED_BY", "INCOMPATIBLE_WITH", "NOT_EQUIVALENT"] as const;
export const LEGACY_TOKEN_STATUSES = ["CANONICAL", "LEGACY_ALIAS", "DEPRECATED", "AMBIGUOUS", "NEEDS_SPLIT"] as const;
export const LEGACY_MAPPING_CORRESPONDENCES = ["EXACT", "PARTIAL", "AMBIGUOUS_CORRESPONDENCE", "MIXED", "NO_MAPPING"] as const;
export type ProfessionalScope = typeof PROFESSIONAL_SCOPES[number];
export type Unvalidated = typeof PROFESSIONAL_VALIDATION_REQUIRED;
export type ExecutabilityRole = typeof EXECUTABILITY_ROLES[number];
export type LegacyTokenStatus = typeof LEGACY_TOKEN_STATUSES[number];
export type LegacyMappingCorrespondence = typeof LEGACY_MAPPING_CORRESPONDENCES[number];
export type ProfessionalRelationshipKind = typeof PROFESSIONAL_RELATIONSHIP_KINDS[number];
export interface ProfessionalObservability {
  readonly observabilityClass: typeof OBSERVABILITY_CLASSES[number];
  readonly typicalChannels: readonly typeof OBSERVABILITY_CHANNELS[number][];
}
export interface ProfessionalRelationship {
  readonly kind: ProfessionalRelationshipKind;
  readonly targetConceptId: string;
}
export interface CanonicalValueReference {
  readonly conceptId: string;
  readonly valueToken: string;
  readonly semanticVersion: string;
  readonly semanticDigest: string;
}
export interface ProfessionalConcept {
  readonly conceptId: string;
  readonly vertical: string;
  readonly discipline?: string;
  readonly canonicalName: string;
  // One multi-valued field: concept type and execution role are not two axes.
  readonly conceptType: readonly ExecutabilityRole[] | Unvalidated;
  readonly scope: ProfessionalScope | Unvalidated;
  readonly appliesTo?: readonly HeadZone[];
  readonly observability?: ProfessionalObservability | Unvalidated;
  readonly canonicalValues?: readonly CanonicalValueReference[];
  readonly relationships?: readonly ProfessionalRelationship[];
  readonly effectRole?: string;
  readonly status?: LegacyTokenStatus;
  readonly legacyMappings?: readonly { readonly token: string; readonly classification: LegacyTokenStatus }[];
  readonly specificationVersion: string;
  readonly specificationDigest: string;
}

export const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const isConceptId = (v: unknown): v is string => typeof v === "string" && /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(v);
export const isSemanticVersion = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(v);
export const isSemanticDigest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
export function member<T extends string>(values: readonly T[], value: unknown): value is T { return typeof value === "string" && (values as readonly string[]).includes(value); }
export function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
export function onlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(v).every(k => keys.includes(k)); }
export function optional(v: unknown, guard: (v: unknown) => boolean): boolean { return v === undefined || guard(v); }
export function arrayOf<T>(v: unknown, guard: (v: unknown) => v is T): v is T[] { return Array.isArray(v) && v.every(guard); }
export function uniqueStrings(v: unknown): v is string[] { return arrayOf(v, isText) && new Set(v).size === v.length; }
export const isProfessionalScope = (v: unknown): v is ProfessionalScope => member(PROFESSIONAL_SCOPES, v);
export const isLegacyTokenStatus = (v: unknown): v is LegacyTokenStatus => member(LEGACY_TOKEN_STATUSES, v);
export const isLegacyMappingCorrespondence = (v: unknown): v is LegacyMappingCorrespondence => member(LEGACY_MAPPING_CORRESPONDENCES, v);
export const isScopeOrPlaceholder = (v: unknown): v is ProfessionalScope | Unvalidated => isProfessionalScope(v) || v === PROFESSIONAL_VALIDATION_REQUIRED;
export function isExecutionRoles(v: unknown): v is readonly ExecutabilityRole[] | Unvalidated {
  return v === PROFESSIONAL_VALIDATION_REQUIRED || (uniqueStrings(v) && v.length > 0 && v.every(x => member(EXECUTABILITY_ROLES, x)));
}
export function isProfessionalObservability(v: unknown): v is ProfessionalObservability {
  return record(v) && onlyKeys(v, ["observabilityClass", "typicalChannels"]) && member(OBSERVABILITY_CLASSES, v.observabilityClass)
    && uniqueStrings(v.typicalChannels) && v.typicalChannels.length > 0 && v.typicalChannels.every(x => member(OBSERVABILITY_CHANNELS, x));
}
export const isObservabilityOrPlaceholder = (v: unknown): v is ProfessionalObservability | Unvalidated => v === PROFESSIONAL_VALIDATION_REQUIRED || isProfessionalObservability(v);
export function isProfessionalRelationship(v: unknown): v is ProfessionalRelationship {
  return record(v) && onlyKeys(v, ["kind", "targetConceptId"]) && member(PROFESSIONAL_RELATIONSHIP_KINDS, v.kind) && isConceptId(v.targetConceptId);
}
export function isCanonicalValueReference(v: unknown): v is CanonicalValueReference {
  return record(v) && onlyKeys(v, ["conceptId", "valueToken", "semanticVersion", "semanticDigest"]) && isConceptId(v.conceptId) && isText(v.valueToken) && isSemanticVersion(v.semanticVersion) && isSemanticDigest(v.semanticDigest);
}
export function isProfessionalConcept(v: unknown): v is ProfessionalConcept {
  return record(v) && onlyKeys(v, ["conceptId", "vertical", "discipline", "canonicalName", "conceptType", "scope", "appliesTo", "observability", "canonicalValues", "relationships", "effectRole", "status", "legacyMappings", "specificationVersion", "specificationDigest"])
    && isConceptId(v.conceptId) && isText(v.vertical) && optional(v.discipline, isText)
    && typeof v.canonicalName === "string" && /^[a-z][A-Za-z0-9]*$/.test(v.canonicalName)
    && isExecutionRoles(v.conceptType) && isScopeOrPlaceholder(v.scope)
    && optional(v.appliesTo, x => arrayOf(x, isHeadZone) && new Set(x).size === x.length)
    && optional(v.observability, isObservabilityOrPlaceholder)
    && optional(v.canonicalValues, x => arrayOf(x, isCanonicalValueReference))
    && optional(v.relationships, x => arrayOf(x, isProfessionalRelationship))
    && optional(v.effectRole, isText) && optional(v.status, isLegacyTokenStatus)
    && optional(v.legacyMappings, x => Array.isArray(x) && x.every(m => record(m) && onlyKeys(m, ["token", "classification"]) && isText(m.token) && isLegacyTokenStatus(m.classification)))
    && isSemanticVersion(v.specificationVersion) && isSemanticDigest(v.specificationDigest);
}

// Verbatim encoder from professional-field-specification-governance.ts. Keep the
// original private implementation untouched; strip undefined during projection.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function semanticFingerprint(projection: object): string {
  return `sha256:${createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(projection))), "utf8").digest("hex")}`;
}
export function conceptDigest(v: Omit<ProfessionalConcept, "specificationDigest">): string {
  return semanticFingerprint({ conceptId: v.conceptId, vertical: v.vertical, discipline: v.discipline,
    canonicalName: v.canonicalName, conceptType: v.conceptType, scope: v.scope, appliesTo: v.appliesTo,
    observability: v.observability, canonicalValues: v.canonicalValues?.map(r => ({ conceptId: r.conceptId, valueToken: r.valueToken, semanticDigest: r.semanticDigest })),
    relationships: v.relationships, effectRole: v.effectRole, status: v.status, legacyMappings: v.legacyMappings });
}
