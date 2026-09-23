import { arrayOf, isConceptId, isLegacyMappingCorrespondence, isLegacyTokenStatus, isSemanticDigest, isSemanticVersion, isText, onlyKeys, optional, record, semanticFingerprint, type LegacyMappingCorrespondence, type LegacyTokenStatus } from "./professional-concept-contracts";

export interface LegacyCorrespondenceEntry {
  readonly targetModelRef: string;
  readonly targetDimension: string;
  readonly targetValue?: string;
  readonly correspondence: LegacyMappingCorrespondence;
  readonly note?: string;
}
export interface ProfessionalCanonicalValue {
  readonly valueToken: string;
  readonly conceptId: string;
  readonly semanticMeaning: string;
  readonly localizedLabels: Readonly<Record<string, string>>;
  readonly legacyAliases?: readonly { readonly alias: string; readonly classification: LegacyTokenStatus }[];
  readonly observability?: string;
  readonly executionSemantics?: string;
  readonly semanticVersion: string;
  readonly semanticDigest: string;
  readonly status: LegacyTokenStatus;
  readonly legacyMappingCorrespondence?: readonly LegacyCorrespondenceEntry[];
}
export function isLocalizedLabels(v: unknown): v is Readonly<Record<string, string>> {
  return record(v) && Object.entries(v).every(([k, label]) => /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(k) && isText(label));
}
export function isLegacyCorrespondenceEntry(v: unknown): v is LegacyCorrespondenceEntry {
  return record(v) && onlyKeys(v, ["targetModelRef", "targetDimension", "targetValue", "correspondence", "note"])
    && isText(v.targetModelRef) && isText(v.targetDimension) && isLegacyMappingCorrespondence(v.correspondence)
    && optional(v.targetValue, isText) && (v.correspondence !== "NO_MAPPING" || v.targetValue === undefined) && optional(v.note, isText);
}
export function isProfessionalCanonicalValue(v: unknown): v is ProfessionalCanonicalValue {
  return record(v) && onlyKeys(v, ["valueToken", "conceptId", "semanticMeaning", "localizedLabels", "legacyAliases", "observability", "executionSemantics", "semanticVersion", "semanticDigest", "status", "legacyMappingCorrespondence"])
    && isText(v.valueToken) && isConceptId(v.conceptId) && isText(v.semanticMeaning) && isLocalizedLabels(v.localizedLabels)
    && optional(v.legacyAliases, x => Array.isArray(x) && x.every(a => record(a) && onlyKeys(a, ["alias", "classification"]) && isText(a.alias) && isLegacyTokenStatus(a.classification)))
    && optional(v.observability, isText) && optional(v.executionSemantics, isText)
    && isSemanticVersion(v.semanticVersion) && isSemanticDigest(v.semanticDigest) && isLegacyTokenStatus(v.status)
    && optional(v.legacyMappingCorrespondence, x => arrayOf(x, isLegacyCorrespondenceEntry));
}
export function canonicalValueDigest(v: Omit<ProfessionalCanonicalValue, "semanticDigest">): string {
  return semanticFingerprint({ valueToken: v.valueToken, conceptId: v.conceptId, semanticMeaning: v.semanticMeaning,
    legacyAliases: v.legacyAliases, observability: v.observability, executionSemantics: v.executionSemantics,
    status: v.status, legacyMappingCorrespondence: v.legacyMappingCorrespondence });
}
