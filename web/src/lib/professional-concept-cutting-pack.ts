import { ELEVATION_OPTIONS, SECTIONING_OPTIONS, GUIDELINE_OPTIONS } from "@/lib/proposal-validators";
import { CUT_ELEVATION_OPTIONS, CUT_SECTIONING_OPTIONS, CUT_GUIDELINE_OPTIONS } from "@/lib/analysis-field-options";
import { conceptDigest, PROFESSIONAL_CONCEPT_SPEC_VERSION, PROFESSIONAL_VALIDATION_REQUIRED, type ProfessionalConcept } from "./professional-concept-contracts";
import { canonicalValueDigest, type LegacyCorrespondenceEntry, type ProfessionalCanonicalValue } from "./professional-canonical-value-contracts";
import { freezeProfessionalPack } from "./professional-concept-registry";
import { definitionDigest, type ProfessionalDefinition } from "./professional-definition-contracts";

// Only the mechanical correspondences explicitly approved in errata #1.
// No target dimension is invented for multiple_reference: its unknown target
// retains the mandatory professional-validation placeholder.
const guideCorrespondence: Readonly<Record<string, LegacyCorrespondenceEntry>> = {
  stationary: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "STATIONARY", correspondence: "PARTIAL" },
  traveling: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "TRAVELLING", correspondence: "PARTIAL" },
  visual_perimeter: { targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideSource", targetValue: "PERIMETER_CONTOUR_GUIDE", correspondence: "AMBIGUOUS_CORRESPONDENCE" },
  multiple_reference: { targetModelRef: "GuideRelationshipCapability", targetDimension: PROFESSIONAL_VALIDATION_REQUIRED, correspondence: "NO_MAPPING" },
};
// c.2c maps only the angle component, never the whole mixed legacy meaning.
const elevationAngleTargets: Readonly<Record<string, string>> = {
  "0_deg_blunt": "0_deg",
  "45_deg_graduation": "45_deg",
  "90_deg_uniform_layer": "90_deg",
  "135_deg_long_layer": "135_deg",
  "180_deg_overdirection": "180_deg",
};
const cleanElevationTokens = ["0_deg", "45_deg", "90_deg", "135_deg", "180_deg"] as const;
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

const canonicalValues: ProfessionalCanonicalValue[] = seeds.flatMap(seed => {
  const legacyValues = seed.tokens.map(valueToken => {
    const value: Omit<ProfessionalCanonicalValue, "semanticDigest"> = {
      conceptId: `haircutting.${seed.name}`, valueToken, semanticMeaning: PROFESSIONAL_VALIDATION_REQUIRED,
      localizedLabels: { en: seed.labels.find(label => label.value === valueToken)!.label },
      semanticVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION, status: "AMBIGUOUS",
      ...(seed.name === "guideType" ? { legacyMappingCorrespondence: [guideCorrespondence[valueToken]] } : {}),
      ...(seed.name === "elevation" ? { legacyMappingCorrespondence: [{ targetModelRef: "haircutting.elevation", targetDimension: "AngleComponent", targetValue: elevationAngleTargets[valueToken], correspondence: "PARTIAL" as const }] } : {}),
    };
    return { ...value, semanticDigest: canonicalValueDigest(value) };
  });
  if (seed.name !== "elevation") return legacyValues;
  const cleanValues = cleanElevationTokens.map(valueToken => {
    const value: Omit<ProfessionalCanonicalValue, "semanticDigest"> = {
      conceptId: "haircutting.elevation", valueToken,
      semanticMeaning: PROFESSIONAL_VALIDATION_REQUIRED,
      localizedLabels: { en: valueToken.replace("_deg", "°") },
      semanticVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION, status: "CANONICAL",
    };
    return { ...value, semanticDigest: canonicalValueDigest(value) };
  });
  return [...legacyValues, ...cleanValues];
});
const concepts: ProfessionalConcept[] = seeds.map(seed => {
  const concept: Omit<ProfessionalConcept, "specificationDigest"> = {
    conceptId: `haircutting.${seed.name}`, vertical: "cutting", canonicalName: seed.name,
    conceptType: seed.tokens.length ? ["PARAMETER"] : PROFESSIONAL_VALIDATION_REQUIRED,
    scope: PROFESSIONAL_VALIDATION_REQUIRED, observability: PROFESSIONAL_VALIDATION_REQUIRED,
    ...(seed.tokens.length ? { status: "AMBIGUOUS" as const, canonicalValues: canonicalValues.filter(v => v.conceptId === `haircutting.${seed.name}`).map(v => ({ conceptId: v.conceptId, valueToken: v.valueToken, semanticVersion: v.semanticVersion, semanticDigest: v.semanticDigest })) } : {}),
    // Clean values are not legacy tokens. The existing legacyMappings field is
    // the architecture-approved explicit status override, not a binding adapter.
    relationships: [], legacyMappings: seed.name === "elevation" ? cleanElevationTokens.map(token => ({ token, classification: "CANONICAL" as const })) : [], specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION,
  };
  return { ...concept, specificationDigest: conceptDigest(concept) };
});

// Direct professional input supplied in the O2 task, recorded in the milestone.
// Scope, observability, execution roles and value meanings are not inferred.
// These concept definitions do not resolve the legacy enums' ambiguity.
const definitionSeeds = [
  { name: "elevation", text: "Elevation is the angle at which a selected hair strand or subsection is lifted and held relative to the shape/curvature of the head during haircutting.", distinguishFrom: ["projection", "overdirection", "cuttingAngle", "cuttingLine", "guide"] },
  { name: "section", text: "A section is a larger deliberately separated working area of the hair/head used to organize and execute the haircut.", distinguishFrom: ["parting", "subsection", "subsectioning"] },
  { name: "subsection", text: "A subsection is a smaller working portion or strand selected from within a larger section for the actual cutting/work operation. Multiple subsections may be worked successively across a section.", distinguishFrom: ["section", "subsectioning", "parting"] },
  { name: "subsectioning", text: "Subsectioning is the process of dividing/selecting smaller working subsections from within a larger section so they can be worked successively.", distinguishFrom: ["subsection"] },
  { name: "parting", text: "A parting is the line/separation used to divide sections or subsections.", distinguishFrom: ["section", "subsection", "sectioning"] },
  { name: "projection", text: "Projection is the directional positioning of a selected strand in the direction or angular position in which it is intended to be worked or cut.", distinguishFrom: ["elevation"] },
  { name: "overdirection", text: "Overdirection is directing a selected strand away from its natural position/fall toward an established guide or cutting reference. It is used to create controlled differences in resulting length or shape after the hair returns to its natural position.", distinguishFrom: ["projection", "elevation"], interpretationRequired: "Guide mobility and overdirection are independent axes: guide mobility asks whether the cutting reference remains fixed or progresses through the haircut; overdirection asks whether hair is directed away from its natural position/fall toward a guide/reference." },
  { name: "guide", text: "A haircutting guide is a previously established hair strand/reference that determines the cutting length/reference for subsequent hair. The guide provides the reference from which subsequent cutting continues.", distinguishFrom: ["elevation", "projection", "overdirection", "cuttingAngle", "cuttingLine", "guideType"] },
] as const;
const definitions: ProfessionalDefinition[] = definitionSeeds.map(seed => {
  const definition: Omit<ProfessionalDefinition, "specificationDigest"> = {
    definitionId: `haircutting.${seed.name}.definition`, conceptId: `haircutting.${seed.name}`,
    text: seed.text, scope: PROFESSIONAL_VALIDATION_REQUIRED,
    distinguishFrom: seed.distinguishFrom.map(name => `haircutting.${name}`),
    ...("interpretationRequired" in seed ? { interpretationRequired: seed.interpretationRequired } : {}),
    sourceLanguage: "en",
    provenance: {
      sourceId: "T1_6_2_C_2B_PROFESSIONALLY_VALIDATED_CANONICAL_DEFINITIONS#professional-input",
      authorityType: "CONFIRMED",
      // Date the supplied validation was recorded by this task, not an invented
      // timestamp for the earlier professional review. See milestone provenance.
      reviewedAt: "2026-09-24",
    },
    specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION,
  };
  return { ...definition, specificationDigest: definitionDigest(definition) };
});

export const CUTTING_PROFESSIONAL_CONCEPT_PACK = freezeProfessionalPack({
  vertical: "cutting", specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION,
  concepts, canonicalValues, definitions,
});
