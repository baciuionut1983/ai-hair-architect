import { arrayOf, conceptDigest, isProfessionalConcept, isSemanticVersion, isText, onlyKeys, PROFESSIONAL_VALIDATION_REQUIRED, record, type ProfessionalConcept, type ProfessionalRelationshipKind } from "./professional-concept-contracts";
import { canonicalValueDigest, isProfessionalCanonicalValue, type ProfessionalCanonicalValue } from "./professional-canonical-value-contracts";
import { definitionDigest, isProfessionalDefinition, type ProfessionalDefinition } from "./professional-definition-contracts";

export interface ProfessionalConceptPack {
  readonly vertical: string;
  readonly specificationVersion: string;
  readonly concepts: readonly ProfessionalConcept[];
  readonly canonicalValues: readonly ProfessionalCanonicalValue[];
  readonly definitions: readonly ProfessionalDefinition[];
}
const valueKey = (v: { conceptId: string; valueToken: string }) => JSON.stringify([v.conceptId, v.valueToken]);

// Pure structural validation only: never resolves aliases, creates decisions,
// promotes private knowledge, or returns a bindable Skill parameter.
export function isValidProfessionalConceptPack(v: unknown): v is ProfessionalConceptPack {
  if (!record(v) || !onlyKeys(v, ["vertical", "specificationVersion", "concepts", "canonicalValues", "definitions"])
    || !isText(v.vertical) || !isSemanticVersion(v.specificationVersion)
    || !arrayOf(v.concepts, isProfessionalConcept) || !v.concepts.length
    || !arrayOf(v.canonicalValues, isProfessionalCanonicalValue) || !arrayOf(v.definitions, isProfessionalDefinition)) return false;
  const concepts = v.concepts;
  const ids = concepts.map(c => c.conceptId);
  if (new Set(ids).size !== ids.length) return false;
  const byId = new Map(concepts.map(c => [c.conceptId, c]));
  const values = new Map(v.canonicalValues.map(c => [valueKey(c), c]));
  const definitions = new Map(v.definitions.map(d => [d.definitionId, d]));
  if (values.size !== v.canonicalValues.length || definitions.size !== v.definitions.length) return false;
  const names = new Set(values.keys());
  for (const value of v.canonicalValues) {
    const concept = byId.get(value.conceptId);
    if (!concept || value.semanticVersion !== v.specificationVersion || value.semanticDigest !== canonicalValueDigest(value)) return false;
    // S explicitly requires uniform O1 statuses. Do not invent an ordering of
    // the five lifecycle states to enable future per-value exceptions here.
    // Correspondence is intentionally not read in this safety check.
    const override = concept.legacyMappings?.find(m => m.token === value.valueToken);
    const expectedStatus = override ? override.classification : concept.status;
    if (expectedStatus !== undefined && value.status !== expectedStatus) return false;
    if (value.semanticMeaning !== PROFESSIONAL_VALIDATION_REQUIRED && definitions.get(value.semanticMeaning)?.conceptId !== value.conceptId) return false;
    for (const alias of value.legacyAliases ?? []) {
      const key = valueKey({ conceptId: value.conceptId, valueToken: alias.alias });
      if (names.has(key)) return false;
      names.add(key);
    }
  }
  const referenced = new Set<string>();
  for (const concept of concepts) {
    if (concept.vertical !== v.vertical || concept.specificationVersion !== v.specificationVersion || concept.specificationDigest !== conceptDigest(concept)) return false;
    for (const ref of concept.canonicalValues ?? []) {
      const key = valueKey(ref);
      const value = values.get(key);
      if (ref.conceptId !== concept.conceptId || !value || referenced.has(key) || value.semanticVersion !== ref.semanticVersion || value.semanticDigest !== ref.semanticDigest) return false;
      referenced.add(key);
    }
    const relationships = concept.relationships ?? [];
    if (new Set(relationships.map(r => JSON.stringify(r))).size !== relationships.length) return false;
    if (relationships.some(r => !byId.has(r.targetConceptId) || r.targetConceptId === concept.conceptId)) return false;
    const mappings = concept.legacyMappings ?? [];
    if (new Set(mappings.map(m => m.token)).size !== mappings.length || mappings.some(m => {
      const value = values.get(valueKey({ conceptId: concept.conceptId, valueToken: m.token }));
      return !value || value.status !== m.classification;
    })) return false;
  }
  if (referenced.size !== values.size) return false;
  for (const definition of v.definitions) {
    if (!byId.has(definition.conceptId) || definition.specificationVersion !== v.specificationVersion || definition.specificationDigest !== definitionDigest(definition)
      || definition.distinguishFrom?.some(id => !byId.has(id) || id === definition.conceptId)) return false;
  }
  // Normalize inverse pairs before the same WHITE/GRAY/BLACK DFS used by
  // isValidAtomicActionSequence. Independent relationship families stay separate.
  const families: readonly (readonly ProfessionalRelationshipKind[])[] = [["PART_OF", "CONTAINS"], ["PRECEDES", "FOLLOWS"], ["APPLIES_TO"], ["CONSTRAINS"], ["REQUIRES"]];
  for (const kinds of families) {
    const edges = new Map(ids.map(id => [id, new Set<string>()]));
    for (const c of concepts) for (const r of c.relationships ?? []) {
      if (!kinds.includes(r.kind)) continue;
      const inverse = r.kind === "CONTAINS" || r.kind === "FOLLOWS";
      edges.get(inverse ? r.targetConceptId : c.conceptId)!.add(inverse ? c.conceptId : r.targetConceptId);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(ids.map(id => [id, WHITE]));
    const hasCycle = (id: string): boolean => {
      color.set(id, GRAY);
      for (const target of edges.get(id) ?? []) {
        const state = color.get(target);
        if (state === GRAY) return true;
        if (state === WHITE && hasCycle(target)) return true;
      }
      color.set(id, BLACK);
      return false;
    };
    for (const id of ids) if (color.get(id) === WHITE && hasCycle(id)) return false;
  }
  return true;
}

export function freezeProfessionalPack<T extends ProfessionalConceptPack>(pack: T): T {
  if (!isValidProfessionalConceptPack(pack)) throw new Error("Invalid professional concept pack");
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  };
  freeze(pack);
  return pack;
}
