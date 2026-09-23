import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { CUT_ELEVATION_OPTIONS, CUT_SECTIONING_OPTIONS, CUT_GUIDELINE_OPTIONS } from "@/lib/analysis-field-options";
import { conceptDigest, PROFESSIONAL_CONCEPT_SPEC_VERSION, PROFESSIONAL_VALIDATION_REQUIRED, type ProfessionalConcept } from "./professional-concept-contracts";
import { canonicalValueDigest, type LegacyCorrespondenceEntry, type ProfessionalCanonicalValue } from "./professional-canonical-value-contracts";
import { freezeProfessionalPack } from "./professional-concept-registry";

// Only the mechanical correspondences explicitly approved in errata #1.
// No target dimension is invented for multiple_reference: its unknown target
// retains the mandatory professional-validation placeholder.
const guideCorrespondence: Readonly<Record<string, LegacyCorrespondenceEntry>> = {
  stationary: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "STATIONARY", correspondence: "PARTIAL" },
  traveling: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "TRAVELLING", correspondence: "PARTIAL" },
  visual_perimeter: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideSource", targetValue: "PERIMETER_CONTOUR_GUIDE", correspondence: "AMBIGUOUS_CORRESPONDENCE" },
  multiple_reference: { targetModelRef: "GuideRelationshipCapability", targetDimension: PROFESSIONAL_VALIDATION_REQUIRED, correspondence: "NO_MAPPING" },
};
const seeds = [
  { name: "elevation", tokens: ELEVATION_OPTIONS, labels: CUT_ELEVATION_OPTIONS },
  { name: "sectioning", tokens: SECTIONING_OPTIONS, labels: CUT_SECTIONING_OPTIONS },
  { name: "guideType", tokens: GUIDELINE_OPTIONS, labels: CUT_GUIDELINE_OPTIONS },
  { name: "cuttingAngle", tokens: [], labels: [] },
  { name: "cuttingLine", tokens: [], labels: [] },
  { name: "section", tokens: [], labels: [] },
  { name: "subsection", tokens: [], labels: [] },
  { name: "subsectioning", tokens: [], labels: [] },
  { name: "parting", tokens: [], labels: [] },
  { name: "projection", tokens: [], labels: [] },
  { name: "overdirection", tokens: [], labels: [] },
  { name: "guide", tokens: [], labels: [] },
] as const;

const canonicalValues: ProfessionalCanonicalValue[] = seeds.flatMap(seed => seed.tokens.map(valueToken => {
  const value: Omit<ProfessionalCanonicalValue, "semanticDigest"> = {
    conceptId: `haircutting.${seed.name}`, valueToken, semanticMeaning: PROFESSIONAL_VALIDATION_REQUIRED,
    localizedLabels: { en: seed.labels.find(label => label.value === valueToken)!.label },
    semanticVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION, status: "AMBIGUOUS",
    ...(seed.name === "guideType" ? { legacyMappingCorrespondence: [guideCorrespondence[valueToken]] } : {}),
  };
  return { ...value, semanticDigest: canonicalValueDigest(value) };
}));
const concepts: ProfessionalConcept[] = seeds.map(seed => {
  const concept: Omit<ProfessionalConcept, "specificationDigest"> = {
    conceptId: `haircutting.${seed.name}`, vertical: "cutting", canonicalName: seed.name,
    conceptType: seed.tokens.length ? ["PARAMETER"] : PROFESSIONAL_VALIDATION_REQUIRED,
    scope: PROFESSIONAL_VALIDATION_REQUIRED, observability: PROFESSIONAL_VALIDATION_REQUIRED,
    ...(seed.tokens.length ? { status: "AMBIGUOUS" as const, canonicalValues: canonicalValues.filter(v => v.conceptId === `haircutting.${seed.name}`).map(v => ({ conceptId: v.conceptId, valueToken: v.valueToken, semanticVersion: v.semanticVersion, semanticDigest: v.semanticDigest })) } : {}),
    relationships: [], legacyMappings: [], specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION,
  };
  return { ...concept, specificationDigest: conceptDigest(concept) };
});

// Identity expansion authorizes seven additional shells only. Definitions,
// detailed scope/roles and new values remain deferred to O2. Existing legacy
// sectioning/guideType semantics and the original five digests are preserved.
export const CUTTING_PROFESSIONAL_CONCEPT_PACK = freezeProfessionalPack({
  vertical: "cutting", specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION,
  concepts, canonicalValues, definitions: [],
});
