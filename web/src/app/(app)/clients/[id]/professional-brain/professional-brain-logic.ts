import { HEAD_ZONES, ZONE_LENGTH_INTENTS, ZONE_WEIGHT_INTENTS, type HeadZone, type ZoneLengthIntent, type ZoneWeightIntent } from "@/lib/technical-visual-map-validators";
import {
  HAIR_STATE_COLOR_LEVEL_VALUES,
  HAIR_STATE_COLOR_TONE_VALUES,
  HAIR_STATE_CONDITION_VALUES,
  HAIR_STATE_DENSITY_VALUES,
  HAIR_STATE_FIBER_THICKNESS_VALUES,
  HAIR_STATE_LENGTH_VALUES,
  HAIR_STATE_PERIMETER_RELATIONSHIPS,
  HAIR_STATE_TEXTURE_VALUES,
  buildUnassessedGlobalEntry,
  buildUnassessedZoneEntry,
  type HairStateColorLevelValue,
  type HairStateColorToneValue,
  type HairStateConditionValue,
  type HairStateDensityValue,
  type HairStateFiberThicknessValue,
  type HairStateLengthValue,
  type HairStatePerimeterRelationship,
  type HairStateSnapshotPayload,
  type HairStateTextureValue,
} from "@/lib/hair-state-snapshot-validators";
import type { BadgeVariant } from "@/components/ui";
import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { HairStateDeltaEntry } from "@/lib/hair-state-delta";
import type { SkillCandidateMatch } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { LanguageCode } from "@/lib/language-registry";
import { DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT, type ProfessionalBrainDomain } from "@/lib/professional-brain-domain-intent-contracts";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, pure UI
// logic. No fetch, no React, no rendering -- testable without a render
// environment, mirroring proposed-look-logic.ts / proposed-look-status-
// badge.tsx's own exact split (pure resolver functions exported alongside
// what a component would use, so a plain `.test.ts` can assert the
// mapping directly).

// ---------------------------------------------------------------------------
// Snapshot status badge (mirrors ProposalStatusBadge's own resolver split).
// ---------------------------------------------------------------------------

export function getSnapshotStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "CONFIRMED":
      return "success";
    case "SUPERSEDED":
      return "warning";
    case "DRAFT":
    default:
      return "neutral";
  }
}

export function getSnapshotStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "CONFIRMED":
      return "Confirmed";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Delta transformation badge -- PRESERVED reads as a stable, good outcome;
// a real change (CHANGED/REDUCED/INCREASED) reads as something requiring
// attention; ADDED/UNKNOWN are neutral (new information / nothing stated
// yet), never alarming.
// ---------------------------------------------------------------------------

export function getTransformationBadgeVariant(transformation: string): BadgeVariant {
  switch (transformation) {
    case "PRESERVED":
      return "success";
    case "CHANGED":
    case "REDUCED":
    case "INCREASED":
      return "warning";
    case "ADDED":
    case "UNKNOWN":
    default:
      return "neutral";
  }
}

// B2.2 -- lengthIntent/weightIntent are the ONE pair of fields whose
// PRESERVED transformation is read directly from the TARGET's own stated
// value, never compared against a real CURRENT baseline (see
// hair-state-delta.ts's own header on classifyLengthIntent/
// classifyWeightIntent -- CURRENT structurally never carries a real
// intent value). A live-caught finding: labeling that identically to a
// genuinely CONFIRMED, both-sides-known continuity (e.g. an unchanged
// color tone) reads as false certainty -- "Preserved" alone can imply
// "we confirmed this stays the same" when it may really mean "the
// professional's stated intent is to keep it this way, from an unknown
// baseline." Kept as a plain field-name check (no capability lookup, no
// export from a protected file) -- deliberately the smallest fix.
const INTENT_FIELDS = new Set(["lengthIntent", "weightIntent"]);

export function isIntentDerivedField(field: string): boolean {
  return INTENT_FIELDS.has(field);
}

export function getTransformationLabel(transformation: string, field?: string): string {
  const isIntent = field !== undefined && isIntentDerivedField(field);
  switch (transformation) {
    case "PRESERVED":
      return isIntent ? "Preserved (stated intent)" : "Preserved (confirmed)";
    case "CHANGED":
      return "Changed";
    case "REDUCED":
      return "Reduced";
    case "INCREASED":
      return "Increased";
    case "ADDED":
      return "Newly stated";
    case "UNKNOWN":
      return "Not yet stated";
    default:
      return transformation;
  }
}

// ---------------------------------------------------------------------------
// Candidate-skill domain -- derived from the real, declared capability, not
// a name/string-matching guess. EVALUATE_COLOR_SERVICE is the ONLY
// color-vertical capability kind (see professional-skill-contracts.ts's
// own header) -- every other real capability kind is a cutting-domain one
// today, so "not color" reads as "cut" without needing a second lookup.
// ---------------------------------------------------------------------------

export type CandidateDomain = "cut" | "color";

export function getCandidateDomain(matchedCapability: string): CandidateDomain {
  return matchedCapability === "EVALUATE_COLOR_SERVICE" ? "color" : "cut";
}

// ---------------------------------------------------------------------------
// API error mapping -- never a raw internal message to the professional.
// Mirrors mapProposedLookApiError's own exact shape/discipline.
// ---------------------------------------------------------------------------

export function mapProfessionalBrainApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This client or snapshot is no longer available.";
  if (status === 409 && code === "HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT") {
    return "This snapshot's confirmed state changed since you loaded it. Reload and try again.";
  }
  if (status === 409) return "This couldn't be completed because the state changed. Reload and try again.";
  if (status === 400) return "Some required information is missing.";
  if (status === 503) return "This is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Payload builders -- pure, deterministic. Every zone except the one
// explicitly edited stays at the honest "not yet assessed" baseline
// (buildUnassessedZoneEntry); every global/color fact left at
// "unspecified" stays "not_yet_assessed" too. A real value set by the
// professional is tagged `professional_input` -- never a fabricated
// `observed`/`ai_proposed` source.
// ---------------------------------------------------------------------------

export interface GlobalCutFactsInput {
  relativeLength: HairStateLengthValue;
  fiberThickness: HairStateFiberThicknessValue;
  density: HairStateDensityValue;
  texture: HairStateTextureValue;
  condition: HairStateConditionValue;
}

export const UNSPECIFIED_GLOBAL_CUT_FACTS: GlobalCutFactsInput = {
  relativeLength: "unspecified",
  fiberThickness: "unspecified",
  density: "unspecified",
  texture: "unspecified",
  condition: "unspecified",
};

export interface ColorFactsInput {
  level: HairStateColorLevelValue;
  tone: HairStateColorToneValue;
}

export const UNSPECIFIED_COLOR_FACTS: ColorFactsInput = { level: "unspecified", tone: "unspecified" };

// B2.2 -- perimeterRelationship added. This is the real, already-modeled
// field ("at_perimeter"/"shorter_than_perimeter"/"longer_than_perimeter")
// that directly expresses "straight line / one length / straight
// perimeter" -- it was never exposed in the B2 form at all, which is the
// root cause a real professional had no honest way to state that request
// (lengthIntent alone does not carry perimeter-shape meaning; "shorten"
// is a DIFFERENT axis -- how much length changes -- not whether the
// result sits in one straight line).
export interface TargetZoneIntentInput {
  zone: HeadZone;
  lengthIntent: ZoneLengthIntent;
  weightIntent: ZoneWeightIntent;
  perimeterRelationship: HairStatePerimeterRelationship;
}

function applyGlobalCutFacts(global: GlobalCutFactsInput) {
  const base = buildUnassessedGlobalEntry();
  return {
    relativeLength: global.relativeLength === "unspecified" ? base.relativeLength : { value: global.relativeLength, source: "professional_input" as const },
    fiberThickness: global.fiberThickness === "unspecified" ? base.fiberThickness : { value: global.fiberThickness, source: "professional_input" as const },
    density: global.density === "unspecified" ? base.density : { value: global.density, source: "professional_input" as const },
    texture: global.texture === "unspecified" ? base.texture : { value: global.texture, source: "professional_input" as const },
    condition: global.condition === "unspecified" ? base.condition : { value: global.condition, source: "professional_input" as const },
  };
}

function applyColorFacts(color: ColorFactsInput) {
  return {
    level: color.level === "unspecified" ? { value: "unspecified" as const, source: "not_yet_assessed" as const } : { value: color.level, source: "professional_input" as const },
    tone: color.tone === "unspecified" ? { value: "unspecified" as const, source: "not_yet_assessed" as const } : { value: color.tone, source: "professional_input" as const },
  };
}

// "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 1 -- `domains` is
// embedded into the CURRENT payload's own `evaluationDomainIntent` (see
// hair-state-snapshot-validators.ts's own field header for why this, not
// a new persistence mechanism, is where a round's domain choice lives).
// Only ever meaningful on CURRENT -- the FIRST snapshot of a round --
// since that is the one this app's own domain-intent resolution reads
// (professional-brain-orchestrator.ts's resolveEvaluationDomainIntent).
export function buildCurrentStatePayload(global: GlobalCutFactsInput, color: ColorFactsInput, domains: readonly ProfessionalBrainDomain[]): HairStateSnapshotPayload {
  return {
    globalState: applyGlobalCutFacts(global),
    zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)),
    colorState: applyColorFacts(color),
    evaluationDomainIntent: { domains },
  };
}

// Reads back the ACTIVE domain intent for a round from its own CURRENT
// snapshot (mirrors professional-brain-orchestrator.ts's own
// resolveEvaluationDomainIntent exactly, client-side, pure -- the page
// already has the full snapshot object from its own fetch, so no second
// server round-trip is needed). Defaults to CUT+COLOR for a snapshot
// created before this requirement existed, or when no CURRENT snapshot
// exists yet at all (the domain-selection step's own fresh starting
// point).
export function resolveClientDomainIntent(currentSnapshot: HairStateSnapshotRecord | null): readonly ProfessionalBrainDomain[] {
  return currentSnapshot?.payload.evaluationDomainIntent?.domains ?? DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT.domains;
}

export function buildTargetStatePayload(global: GlobalCutFactsInput, color: ColorFactsInput, zoneIntent: TargetZoneIntentInput | null): HairStateSnapshotPayload {
  const zones = HEAD_ZONES.map((zone) => {
    const entry = buildUnassessedZoneEntry(zone);
    if (!zoneIntent || zoneIntent.zone !== zone) return entry;
    return {
      ...entry,
      lengthIntent: zoneIntent.lengthIntent === "unspecified" ? entry.lengthIntent : { value: zoneIntent.lengthIntent, source: "professional_input" as const },
      weightIntent: zoneIntent.weightIntent === "unspecified" ? entry.weightIntent : { value: zoneIntent.weightIntent, source: "professional_input" as const },
      perimeterRelationship:
        zoneIntent.perimeterRelationship === "unspecified" ? entry.perimeterRelationship : { value: zoneIntent.perimeterRelationship, source: "professional_input" as const },
    };
  });
  return { globalState: applyGlobalCutFacts(global), zones, colorState: applyColorFacts(color) };
}

// ---------------------------------------------------------------------------
// Select option lists -- reused directly by the page, never hand-retyped.
// ---------------------------------------------------------------------------

export const GLOBAL_LENGTH_OPTIONS = HAIR_STATE_LENGTH_VALUES;
export const GLOBAL_FIBER_THICKNESS_OPTIONS = HAIR_STATE_FIBER_THICKNESS_VALUES;
export const GLOBAL_DENSITY_OPTIONS = HAIR_STATE_DENSITY_VALUES;
export const GLOBAL_TEXTURE_OPTIONS = HAIR_STATE_TEXTURE_VALUES;
export const GLOBAL_CONDITION_OPTIONS = HAIR_STATE_CONDITION_VALUES;
export const COLOR_LEVEL_OPTIONS = HAIR_STATE_COLOR_LEVEL_VALUES;
export const COLOR_TONE_OPTIONS = HAIR_STATE_COLOR_TONE_VALUES;
export const ZONE_OPTIONS = HEAD_ZONES;
export const ZONE_LENGTH_INTENT_OPTIONS = ZONE_LENGTH_INTENTS;
export const ZONE_WEIGHT_INTENT_OPTIONS = ZONE_WEIGHT_INTENTS;
export const PERIMETER_RELATIONSHIP_OPTIONS = HAIR_STATE_PERIMETER_RELATIONSHIPS;

// ---------------------------------------------------------------------------
// B2.1 -- SAFE NEW-EVALUATION-ROUND helper. This is the one rule that
// makes "confirm a fresh snapshot after an earlier one is already
// CONFIRMED" work correctly instead of a hardcoded `null`: since
// pickSnapshot (professional-brain-orchestrator.ts) always prefers a
// CONFIRMED row over any newer DRAFT, `currentSnapshot` from the
// evaluation GET is EITHER the still-unconfirmed draft being worked on
// (expected id: null, nothing confirmed yet) OR the previously CONFIRMED
// row a new draft is about to supersede (expected id: that row's own
// id) -- there is no third case. Passing the wrong value here either
// fails a legitimate first confirmation (false 409) or -- far worse --
// would let a stale client silently confirm over a newer approval it
// never saw. Always compute this fresh from the live snapshot, never
// cache it across a render.
// ---------------------------------------------------------------------------

export function getExpectedConfirmedSnapshotId(snapshot: HairStateSnapshotRecord | null): string | null {
  return snapshot && snapshot.status === "CONFIRMED" ? snapshot.id : null;
}

// ---------------------------------------------------------------------------
// B2.1 -- color-candidate detection + the real skill identity it keys
// off. Used to decide when the "what's missing for color" disclosure
// must render -- see page.tsx's ColorReadinessNotice.
// ---------------------------------------------------------------------------

export const COLOR_EVALUATION_GATE_SKILL_KEY = "skill-color-global-single-process-evaluation-gate";

export function hasColorCandidate(matches: readonly SkillCandidateMatch[]): boolean {
  return matches.some((m) => m.skillKey === COLOR_EVALUATION_GATE_SKILL_KEY);
}

// ---------------------------------------------------------------------------
// B2.2 -- GROUPED candidate display. A live-caught finding: two rows for
// the SAME skill (e.g. one color skill matching both a colorLevel change
// and an unchanged-but-still-required colorTone) rendered as two flat,
// unrelated-looking list items, easy to misread as "two separate
// findings." This groups by skillDefinitionId (unique per skill+version,
// see professional-brain-skill-templates.ts's own toRecord id scheme) so
// the UI can show ONE card per skill with every capability/delta it
// addresses listed underneath -- never merging or hiding a real match,
// only presenting the SAME facts legibly.
// ---------------------------------------------------------------------------

export interface GroupedCandidateEntry {
  deltaEntry: SkillCandidateMatch["deltaEntry"];
  matchedCapability: SkillCandidateMatch["matchedCapability"];
  deterministicReason: string;
}
export interface GroupedSkillCandidate {
  skillDefinitionId: string;
  skillKey: string;
  skillVersion: number;
  domain: CandidateDomain;
  entries: readonly GroupedCandidateEntry[];
}

export function groupCandidateMatchesBySkill(matches: readonly SkillCandidateMatch[]): readonly GroupedSkillCandidate[] {
  const bySkill = new Map<string, { group: GroupedSkillCandidate; entries: GroupedCandidateEntry[] }>();
  for (const m of matches) {
    let bucket = bySkill.get(m.skillDefinitionId);
    if (!bucket) {
      const entries: GroupedCandidateEntry[] = [];
      bucket = { group: { skillDefinitionId: m.skillDefinitionId, skillKey: m.skillKey, skillVersion: m.skillVersion, domain: getCandidateDomain(m.matchedCapability), entries }, entries };
      bySkill.set(m.skillDefinitionId, bucket);
    }
    bucket.entries.push({ deltaEntry: m.deltaEntry, matchedCapability: m.matchedCapability, deterministicReason: m.deterministicReason });
  }
  return [...bySkill.values()].map((b) => b.group);
}

// ---------------------------------------------------------------------------
// B2.2 -- unresolved-delta clarity. A live-caught finding: the page only
// showed a COUNT ("N change(s) have no matching registered skill yet"),
// never which ones or why -- exactly the opposite of "afișarea...
// schimbărilor nerezolvate trebuie să fie clară." This never invents a
// missing capability name (that would require exporting a private
// mapping from a protected file, see hair-state-delta-skill-candidate-
// selector.ts's own file header) -- it only restates the already-real
// scope/field/target/transformation, honestly, plus the one fact that IS
// always true: no registered skill currently addresses it.
// ---------------------------------------------------------------------------

export function describeUnresolvedDelta(entry: Pick<HairStateDeltaEntry, "scope" | "field" | "target" | "transformation">, language: LanguageCode): string {
  const label = getTransformationLabel(entry.transformation, entry.field);
  if (language === "ro") {
    return `${entry.scope} / ${entry.field}: țintă "${entry.target.value}" (${label}) -- niciun skill înregistrat nu acoperă încă această schimbare.`;
  }
  return `${entry.scope} / ${entry.field}: target "${entry.target.value}" (${label}) -- no registered skill currently addresses this.`;
}

// ---------------------------------------------------------------------------
// B2.2 -- page-local EN/RO strings. Deliberately NOT wired into the
// shared web/src/lib/translations.ts dictionary: that system's own test
// (translations.test.ts, "is true for all eighteen UI-supported
// languages") requires EVERY key to be genuinely translated into all 18
// registered UI languages, not just the two this task asked for -- adding
// keys there without real, correct translations for the other sixteen
// would either break that test or ship low-confidence machine-guessed
// text for safety-adjacent copy (chemical history disclosures) in
// languages this session cannot responsibly verify. This page instead
// reuses the REAL, already-live locale signal (useUiLanguage()'s
// `language`, sourced from the session's own resolved UI language -- see
// ui-language-context.tsx) to choose between two genuinely-authored
// dictionaries, English and Romanian, scoped to exactly what this page
// needs -- the smallest honest way to satisfy "use the interface in
// Romanian when locale is Romanian" without overclaiming eighteen-language
// coverage nobody asked for.
// ---------------------------------------------------------------------------

export type PbStringKey =
  | "pageTitle"
  | "flowStopsTitle"
  | "flowStopsBody"
  | "currentStateHeading"
  | "targetStateHeading"
  | "deltaHeading"
  | "relativeLengthLabel"
  | "fiberThicknessLabel"
  | "densityLabel"
  | "textureLabel"
  | "conditionLabel"
  | "colorLevelLabel"
  | "colorToneLabel"
  | "zoneLabel"
  | "lengthIntentLabel"
  | "weightIntentLabel"
  | "perimeterRelationshipLabel"
  | "createCurrentButton"
  | "createTargetButton"
  | "confirmCurrentButton"
  | "confirmTargetButton"
  | "startNewEvaluationButton"
  | "cancelAndGoBack"
  | "zoneFactsHelpNote"
  | "oneLengthHint"
  | "newRoundTitle"
  | "newRoundBody"
  | "unresolvedTitle"
  | "unresolvedIntro"
  | "colorMissingTitle"
  | "colorMissingChemicalHistory"
  | "colorMissingStrandTest"
  | "colorMissingDetermination"
  | "colorMissingAuthorization"
  | "vocabularyTitle"
  | "vocabularyCandidateSkill"
  | "vocabularyApprovedPlan"
  | "vocabularyExecution"
  | "cutBadge"
  | "colorBadge"
  | "stylingBadge"
  | "evaluationGateNote"
  | "confirmedValuesHeading"
  | "noCandidatesYet"
  | "backToPrefix"
  | "domainSelectionHeading"
  | "domainSelectionHelp"
  | "domainSelectionFrozenNote"
  | "domainSelectionEmptyError"
  | "domainActiveLabel"
  | "stylingGapTitle"
  | "stylingGapIntro"
  | "stylingGapMissingContractsHeading"
  | "stylingGapMissingFactsHeading"
  | "noFieldsForSelectedDomains";

const PB_EN: Record<PbStringKey, string> = {
  pageTitle: "CUT + COLOR evaluation",
  flowStopsTitle: "Where this flow stops",
  flowStopsBody:
    "This evaluation computes a delta and candidate skills for cut and color, deterministically, from the states you confirm below. It never calls the paid AI reasoning step and never starts video generation. Turning an approved evaluation into a professional plan or a demonstration is a separate, explicitly authorized next step -- not part of this page.",
  currentStateHeading: "1. Current state",
  targetStateHeading: "2. Target state",
  deltaHeading: "3. Delta and candidate skills",
  relativeLengthLabel: "Relative length",
  fiberThicknessLabel: "Fiber thickness",
  densityLabel: "Density",
  textureLabel: "Texture",
  conditionLabel: "Condition",
  colorLevelLabel: "Color level",
  colorToneLabel: "Color tone",
  zoneLabel: "Zone",
  lengthIntentLabel: "Length intent",
  weightIntentLabel: "Weight intent",
  perimeterRelationshipLabel: "Perimeter relationship",
  createCurrentButton: "Create current state",
  createTargetButton: "Create target state",
  confirmCurrentButton: "Confirm current state",
  confirmTargetButton: "Confirm target state",
  startNewEvaluationButton: "Start a new evaluation",
  cancelAndGoBack: "Cancel and go back",
  zoneFactsHelpNote: "Only the chosen zone's values are set; every other zone stays honestly unassessed.",
  oneLengthHint:
    "Perimeter relationship records a real, stated intent (for example \"at perimeter\" for a straight, one-length result), but on its own it does not yet match any registered skill -- a known registry gap, not a problem with what you're recording; see Unresolved below. Length intent is evaluated separately: \"preserve\"/\"maintain\" matches a guide-establishing skill, and \"shorten\" matches a length-reduction skill in some zones -- neither depends on the Perimeter relationship value.",
  newRoundTitle: "New evaluation round",
  newRoundBody: "You're recording a new current/target state. The previous confirmed evaluation stays exactly as it was approved -- it will only be marked superseded, automatically, once this new round is itself confirmed.",
  unresolvedTitle: "Unresolved",
  unresolvedIntro: "These changes have no matching registered skill yet. Reported honestly, never guessed or invented:",
  colorMissingTitle: "What's missing for color, and what this evaluation does not authorize",
  colorMissingChemicalHistory: "Chemical history for this client: Unknown -- not recorded anywhere in this flow.",
  colorMissingStrandTest: "Strand test for this client: Unknown -- not recorded anywhere in this flow.",
  colorMissingDetermination: "Stylist's own determination: Not yet recorded.",
  colorMissingAuthorization:
    "This evaluation does not authorize a color formula, developer volume, processing time, or any chemical execution. A professional must independently confirm all three above, in person, before any color service.",
  vocabularyTitle: "Candidate skill, approved plan, and execution are three different things",
  vocabularyCandidateSkill: "Candidate skill: a registered skill whose declared capability structurally matches this delta. It is a possibility the system found, never a decision.",
  vocabularyApprovedPlan: "Approved professional plan: exists only after a professional reviews AI-assisted reasoning (a separate, paid step this page never calls) and explicitly confirms it.",
  vocabularyExecution: "Execution: the real haircut or color service performed by the professional, or a generated video demonstration -- neither ever happens from this page.",
  cutBadge: "Cut",
  colorBadge: "Color",
  stylingBadge: "Styling",
  evaluationGateNote: "Evaluation gate, not an execution -- see below.",
  confirmedValuesHeading: "Confirmed values",
  noCandidatesYet: "No candidate skills matched yet.",
  backToPrefix: "Back to",
  domainSelectionHeading: "0. Which service(s) is this evaluation for?",
  domainSelectionHelp:
    "Choose any combination of Cut, Color, and Styling. This choice scopes both the form below and the actual computed result -- not just what's displayed. It stays fixed for the rest of this evaluation round.",
  domainSelectionFrozenNote: "Fixed for this confirmed evaluation -- start a new evaluation to choose differently.",
  domainSelectionEmptyError: "Choose at least one service.",
  domainActiveLabel: "This evaluation covers:",
  stylingGapTitle: "Styling has no engine yet",
  stylingGapIntro: "This evaluation includes Styling, which cannot be computed honestly yet. Nothing is fabricated -- here is exactly what's missing:",
  stylingGapMissingContractsHeading: "Missing contracts/modules",
  stylingGapMissingFactsHeading: "Missing professional facts",
  noFieldsForSelectedDomains: "No fields to record yet for the selected service(s).",
};

const PB_RO: Record<PbStringKey, string> = {
  pageTitle: "Evaluare TUNS + CULOARE",
  flowStopsTitle: "Unde se oprește acest flux",
  flowStopsBody:
    "Această evaluare calculează un delta și skill-uri candidate pentru tuns și culoare, determinist, din stările confirmate mai jos. Nu apelează niciodată pasul de raționament AI plătit și nu pornește generarea de video. Transformarea unei evaluări aprobate într-un plan profesional sau o demonstrație este un pas următor separat, autorizat explicit -- nu face parte din această pagină.",
  currentStateHeading: "1. Starea curentă",
  targetStateHeading: "2. Starea țintă",
  deltaHeading: "3. Delta și skill-uri candidate",
  relativeLengthLabel: "Lungime relativă",
  fiberThicknessLabel: "Grosimea firului",
  densityLabel: "Densitate",
  textureLabel: "Textură",
  conditionLabel: "Stare",
  colorLevelLabel: "Nivel de culoare",
  colorToneLabel: "Ton de culoare",
  zoneLabel: "Zonă",
  lengthIntentLabel: "Intenție lungime",
  weightIntentLabel: "Intenție greutate",
  perimeterRelationshipLabel: "Relație cu perimetrul",
  createCurrentButton: "Creează starea curentă",
  createTargetButton: "Creează starea țintă",
  confirmCurrentButton: "Confirmă starea curentă",
  confirmTargetButton: "Confirmă starea țintă",
  startNewEvaluationButton: "Începe o evaluare nouă",
  cancelAndGoBack: "Anulează și revino",
  zoneFactsHelpNote: "Sunt setate doar valorile pentru zona aleasă; fiecare altă zonă rămâne onest neevaluată.",
  oneLengthHint:
    "Relația cu perimetrul înregistrează o intenție reală, declarată (de exemplu \"la perimetru\" pentru un rezultat drept, pe o singură lungime), dar, de una singură, nu se potrivește încă cu niciun skill înregistrat -- un gol cunoscut în registru, nu o problemă cu ce înregistrezi; vezi secțiunea Nerezolvate mai jos. Intenția de lungime este evaluată separat: \"păstrează\"/\"menține\" se potrivește cu un skill care stabilește ghidul, iar \"scurtează\" se potrivește cu un skill de reducere a lungimii în anumite zone -- niciuna nu depinde de valoarea Relației cu perimetrul.",
  newRoundTitle: "Rundă nouă de evaluare",
  newRoundBody: "Înregistrezi o stare curentă/țintă nouă. Evaluarea confirmată anterior rămâne exact așa cum a fost aprobată -- va fi marcată drept înlocuită (superseded) automat, doar când această rundă nouă va fi ea însăși confirmată.",
  unresolvedTitle: "Nerezolvate",
  unresolvedIntro: "Aceste schimbări nu au încă niciun skill înregistrat care să le acopere. Raportat onest, niciodată ghicit sau inventat:",
  colorMissingTitle: "Ce lipsește pentru culoare și ce nu autorizează această evaluare",
  colorMissingChemicalHistory: "Istoricul chimic al acestui client: Necunoscut -- nu este înregistrat nicăieri în acest flux.",
  colorMissingStrandTest: "Testul de șuviță pentru acest client: Necunoscut -- nu este înregistrat nicăieri în acest flux.",
  colorMissingDetermination: "Decizia proprie a stilistului: Nu este încă înregistrată.",
  colorMissingAuthorization:
    "Această evaluare nu autorizează o formulă de culoare, un volum de oxidant, un timp de procesare sau orice execuție chimică. Un profesionist trebuie să confirme independent, în persoană, toate cele trei de mai sus, înainte de orice serviciu de culoare.",
  vocabularyTitle: "Skill candidat, plan aprobat și execuție sunt trei lucruri diferite",
  vocabularyCandidateSkill: "Skill candidat: un skill înregistrat a cărui capabilitate declarată se potrivește structural cu acest delta. E o posibilitate găsită de sistem, niciodată o decizie.",
  vocabularyApprovedPlan: "Plan profesional aprobat: există doar după ce un profesionist revizuiește un raționament asistat de AI (un pas separat, plătit, pe care această pagină nu îl apelează niciodată) și îl confirmă explicit.",
  vocabularyExecution: "Execuție: tunsoarea sau serviciul de culoare real, efectuat de profesionist, sau o demonstrație video generată -- niciuna nu se întâmplă vreodată din această pagină.",
  cutBadge: "Tuns",
  colorBadge: "Culoare",
  stylingBadge: "Coafare",
  evaluationGateNote: "Poartă de evaluare, nu o execuție -- vezi mai jos.",
  confirmedValuesHeading: "Valori confirmate",
  noCandidatesYet: "Niciun skill candidat potrivit încă.",
  backToPrefix: "Înapoi la",
  domainSelectionHeading: "0. Pentru ce serviciu (servicii) este această evaluare?",
  domainSelectionHelp:
    "Alege orice combinație dintre Tuns, Culoare și Coafare. Această alegere delimitează atât formularul de mai jos, cât și rezultatul calculat efectiv -- nu doar ce se afișează. Rămâne fixă pentru restul acestei runde de evaluare.",
  domainSelectionFrozenNote: "Fixă pentru această evaluare confirmată -- începe o evaluare nouă ca să alegi altfel.",
  domainSelectionEmptyError: "Alege cel puțin un serviciu.",
  domainActiveLabel: "Această evaluare acoperă:",
  stylingGapTitle: "Coafarea nu are încă un motor",
  stylingGapIntro: "Această evaluare include Coafare, care nu poate fi calculată onest încă. Nu se inventează nimic -- iată exact ce lipsește:",
  stylingGapMissingContractsHeading: "Contracte/module lipsă",
  stylingGapMissingFactsHeading: "Fapte profesionale lipsă",
  noFieldsForSelectedDomains: "Niciun câmp de înregistrat încă pentru serviciul (serviciile) alese.",
};

export function pbTranslate(language: LanguageCode, key: PbStringKey): string {
  return language === "ro" ? PB_RO[key] : PB_EN[key];
}
