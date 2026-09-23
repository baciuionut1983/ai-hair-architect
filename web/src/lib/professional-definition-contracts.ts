import { arrayOf, isConceptId, isObservabilityOrPlaceholder, isScopeOrPlaceholder, isSemanticDigest, isSemanticVersion, isText, onlyKeys, optional, record, semanticFingerprint, uniqueStrings, type ProfessionalObservability, type ProfessionalScope, type Unvalidated } from "./professional-concept-contracts";
import { isLocalizedLabels } from "./professional-canonical-value-contracts";

// Future O2 shape only. No definition instances or authority records ship in O1.
export interface ProfessionalDefinition {
  readonly definitionId: string;
  readonly conceptId: string;
  readonly text: string;
  readonly scope: ProfessionalScope | Unvalidated;
  readonly distinguishFrom?: readonly string[];
  readonly observability?: ProfessionalObservability | Unvalidated;
  readonly interpretationRequired?: string;
  readonly executionRole?: string;
  readonly effectClaims?: readonly string[];
  readonly sourceLanguage?: string;
  readonly sourceTerm?: string;
  readonly localizedLabels?: Readonly<Record<string, string>>;
  readonly provenance: { readonly authorId?: string; readonly sourceId?: string; readonly authorityType: string; readonly reviewedAt: string };
  readonly specificationVersion: string;
  readonly specificationDigest: string;
}
export function isProfessionalDefinition(v: unknown): v is ProfessionalDefinition {
  if (!record(v) || !onlyKeys(v, ["definitionId", "conceptId", "text", "scope", "distinguishFrom", "observability", "interpretationRequired", "executionRole", "effectClaims", "sourceLanguage", "sourceTerm", "localizedLabels", "provenance", "specificationVersion", "specificationDigest"])) return false;
  const p = v.provenance;
  return isText(v.definitionId) && isConceptId(v.conceptId) && isText(v.text) && isScopeOrPlaceholder(v.scope)
    && optional(v.distinguishFrom, x => uniqueStrings(x) && arrayOf(x, isConceptId))
    && optional(v.observability, isObservabilityOrPlaceholder) && optional(v.interpretationRequired, isText)
    && optional(v.executionRole, isText) && optional(v.effectClaims, uniqueStrings) && optional(v.sourceLanguage, isText)
    && optional(v.sourceTerm, isText) && optional(v.localizedLabels, isLocalizedLabels)
    && record(p) && onlyKeys(p, ["authorId", "sourceId", "authorityType", "reviewedAt"])
    && optional(p.authorId, isText) && optional(p.sourceId, isText) && (isText(p.authorId) || isText(p.sourceId))
    && isText(p.authorityType) && isText(p.reviewedAt) && Number.isFinite(Date.parse(p.reviewedAt))
    && isSemanticVersion(v.specificationVersion) && isSemanticDigest(v.specificationDigest);
}
export function definitionDigest(v: Omit<ProfessionalDefinition, "specificationDigest">): string {
  return semanticFingerprint({ conceptId: v.conceptId, text: v.text, scope: v.scope, distinguishFrom: v.distinguishFrom,
    observability: v.observability, interpretationRequired: v.interpretationRequired, executionRole: v.executionRole,
    effectClaims: v.effectClaims, sourceLanguage: v.sourceLanguage, sourceTerm: v.sourceTerm,
    provenance: { authorityType: v.provenance.authorityType } });
}
