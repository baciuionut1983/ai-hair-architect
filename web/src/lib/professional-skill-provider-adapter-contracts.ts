import { isRecord } from "@/lib/technical-visual-map-validators";
import { isAtomicActionEvidenceStatus, type AtomicActionEvidenceStatus } from "@/lib/professional-skill-atomic-action-contracts";
import { isDemonstrationRequirementCategory, type DemonstrationRequirement, type DemonstrationRequirementCategory } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { isFramingSemantic, isViewpointFamily, type FramingSemantic, type ViewpointConstraint, type ViewpointFamily } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import type { VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.21 -- PROVIDER ADAPTER, contract/
// foundation only. Types + pure structural validators, no I/O, no
// database, no provider call, no AI -- mirrors Stage 2.5.i.13's own
// established "Stage 1" convention exactly. UNIVERSAL, not cutting-
// specific -- named accordingly (professional-skill-*, not cutting-
// skill-*).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.15/i.17 audits): the Provider Adapter
// is a TRANSLATOR, never authority. It may only serialize already-
// approved semantics already proven reachable by Stage 2.5.i.13
// (VideoInstruction) / Stage 2.5.i.19 (Demonstration Requirement value
// reachability) -- it creates NO new professional salon authority, NO
// new cinematographic authority, and NO provider-specific syntax. This
// file sits strictly between VideoInstruction (Stage 2.5.i.13/i.14) and
// a future concrete provider implementation (Veo, or any other) --
// ZERO compiler/translation FUNCTION exists here (see
// cutting-skill-provider-adapter-compiler.ts for that); this file is
// contract-only, mirroring Stage 2.5.i.13's own exact split.
//
// REFERENCES, NOT RE-DECLARATIONS -- exactly like VideoInstruction's own
// established boundary: this contract does NOT duplicate Skill/Skill
// Instance/Execution Unit/Atomic Action identity beyond what a segment's
// own `sourceVideoInstructionId`/`sourceAtomicActionId` already carries
// transitively reachable, and does NOT re-embed Demonstration
// Requirement/Viewpoint Constraint CONTENT beyond the minimal resolved
// `value` a segment needs to be provider-translatable -- every fact
// still carries its own `sourceDemonstrationRequirementId` for full
// traceability back to upstream authority (Stage 2.5.i.17's own
// "provenance" requirement).
//
// PRECONDITIONS ARE ASSERTIONS, NEVER DECISIONS (Stage 2.5.i.20's own
// explicit boundary): `authorizationStatus` and
// `visualReferenceQualification` are narrow, closed-vocabulary SIGNALS
// this contract accepts as already-resolved input from an upstream gate
// -- this file creates NEITHER concept, persists NEITHER, and infers
// NEITHER from anything (not from pixels, not from prose, not from
// client history). A future consent/quality-gate implementation stage
// owns producing these values; this contract only ever consumes them.
//
// EXACTLY ONE VISUAL REFERENCE (Stage 2.5.i.20's own "first pilot"
// lock): `visualReference` is a single object, never an array --
// structurally impossible to supply more than one, matching this
// stage's own explicit "no arbitrary fallback image selection, no
// multiple images for first pilot" rule.
//
// SEMANTIC FACTS, NOT CINEMATOGRAPHY (Stage 2.5.i.15/i.17's own already-
// locked boundary, reaffirmed here): `ProviderAdapterSemanticFact` only
// ever carries a `category` (Stage 2.5.i.10's own already-universal
// vocabulary) and a resolved `value` -- there is no field anywhere in
// this file capable of representing an angle, a distance, a lens, a
// duration, a frame count, or any provider-specific token. A future
// concrete provider serializer, not this contract, decides how a
// semantic fact becomes provider syntax.
//
// ONE REAL GENERATION INTENT TODAY ("TECHNICAL_EXECUTION_DEMONSTRATION")
// -- deliberately, mirroring Stage 2.5.i.12's own "one real viewpoint
// family" minimalism: nothing in real content today justifies a second
// intent value; growing this vocabulary is deferred until real content
// actually needs one.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.21's own explicit boundary):
//   - it implements ZERO translation function -- nothing here ever
//     produces a ProviderAdapterTranslationOutput from a real
//     VideoInstruction sequence; that pure, deterministic assembly lives
//     in cutting-skill-provider-adapter-compiler.ts, mirroring the exact
//     universal-contract/pilot-compiler split already established by
//     Stage 2.5.i.13/i.14;
//   - it does NOT call, name, or reference any concrete provider (no
//     Veo, no Gemini, no model string, no API shape) anywhere;
//   - it does NOT create, persist, infer, or validate consent -- see the
//     PRECONDITIONS comment above;
//   - it does NOT perform image-quality detection of any kind -- see the
//     PRECONDITIONS comment above;
//   - it is NOT persisted -- no Prisma model, no migration;
//   - it does NOT modify professional-skill-video-instruction-
//     contracts.ts, cutting-skill-video-instruction-compiler.ts, or any
//     prior contract file -- this is a strictly additive, new file pair.

// ---------------------------------------------------------------------------
// Visual reference -- exactly one, explicitly classified. See file
// header for why only one real classification value exists today.
// ---------------------------------------------------------------------------

export const VISUAL_REFERENCE_CLASSIFICATIONS = ["VISUAL_REFERENCE_ONLY"] as const;
export type VisualReferenceClassification = (typeof VISUAL_REFERENCE_CLASSIFICATIONS)[number];

export function isVisualReferenceClassification(value: unknown): value is VisualReferenceClassification {
  return typeof value === "string" && (VISUAL_REFERENCE_CLASSIFICATIONS as readonly string[]).includes(value);
}

export interface ProviderAdapterVisualReference {
  imageAssetId: string;
  classification: VisualReferenceClassification;
}

export function isValidProviderAdapterVisualReference(value: unknown): value is ProviderAdapterVisualReference {
  if (!isRecord(value)) return false;
  if (typeof value.imageAssetId !== "string" || value.imageAssetId.length === 0) return false;
  if (!isVisualReferenceClassification(value.classification)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Precondition signals -- narrow, closed, ASSERTED only. See file header
// -- this contract never creates, persists, or infers either.
// ---------------------------------------------------------------------------

export const AUTHORIZATION_PRECONDITION_STATUSES = ["VALIDATED", "NOT_VALIDATED"] as const;
export type AuthorizationPreconditionStatus = (typeof AUTHORIZATION_PRECONDITION_STATUSES)[number];

export function isAuthorizationPreconditionStatus(value: unknown): value is AuthorizationPreconditionStatus {
  return typeof value === "string" && (AUTHORIZATION_PRECONDITION_STATUSES as readonly string[]).includes(value);
}

export const VISUAL_REFERENCE_QUALIFICATION_STATUSES = ["QUALIFIED", "NOT_QUALIFIED"] as const;
export type VisualReferenceQualificationStatus = (typeof VISUAL_REFERENCE_QUALIFICATION_STATUSES)[number];

export function isVisualReferenceQualificationStatus(value: unknown): value is VisualReferenceQualificationStatus {
  return typeof value === "string" && (VISUAL_REFERENCE_QUALIFICATION_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Generation intent -- see file header for why only one real value
// exists today.
// ---------------------------------------------------------------------------

export const PROVIDER_ADAPTER_GENERATION_INTENTS = ["TECHNICAL_EXECUTION_DEMONSTRATION"] as const;
export type ProviderAdapterGenerationIntent = (typeof PROVIDER_ADAPTER_GENERATION_INTENTS)[number];

export function isProviderAdapterGenerationIntent(value: unknown): value is ProviderAdapterGenerationIntent {
  return typeof value === "string" && (PROVIDER_ADAPTER_GENERATION_INTENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Translation input -- what the adapter receives. TFact only needed for
// the Demonstration Requirement array (VideoInstruction/ViewpointConstraint
// are already fact-agnostic, id-reference-only, per their own Stage
// 2.5.i.13/i.12 design).
// ---------------------------------------------------------------------------

export interface ProviderAdapterTranslationRequest<TFact extends string = string> {
  // Ordered, one Execution Unit's worth -- grouping is an orchestration-
  // layer responsibility (Stage 2.5.i.17's own conclusion), never
  // re-derived here.
  videoInstructions: readonly VideoInstruction[];
  demonstrationRequirements: readonly DemonstrationRequirement<TFact>[];
  viewpointConstraints: readonly ViewpointConstraint[];
  visualReference: ProviderAdapterVisualReference;
  // Optional at the structural level -- their ABSENCE is exactly as
  // fail-closed as an explicit NOT_VALIDATED/NOT_QUALIFIED value; the
  // translation function (cutting-skill-provider-adapter-compiler.ts)
  // is what actually enforces "must equal VALIDATED/QUALIFIED".
  authorizationStatus?: AuthorizationPreconditionStatus;
  visualReferenceQualification?: VisualReferenceQualificationStatus;
  // Opaque, caller-assigned identity for this one translation attempt --
  // carried through to the output for provenance/traceability only;
  // this contract does not implement or require request sealing/
  // persistence itself (Stage 2.5.i.20's own explicit boundary).
  sealedRequestId: string;
}

export function isValidProviderAdapterTranslationRequest<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is ProviderAdapterTranslationRequest<TFact> {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.videoInstructions) || value.videoInstructions.length === 0) return false;
  if (!Array.isArray(value.demonstrationRequirements)) return false;
  if (!Array.isArray(value.viewpointConstraints)) return false;
  if (!isValidProviderAdapterVisualReference(value.visualReference)) return false;
  if (value.authorizationStatus !== undefined && !isAuthorizationPreconditionStatus(value.authorizationStatus)) return false;
  if (value.visualReferenceQualification !== undefined && !isVisualReferenceQualificationStatus(value.visualReferenceQualification)) return false;
  if (typeof value.sealedRequestId !== "string" || value.sealedRequestId.length === 0) return false;
  // Fact-guard parameter kept for signature symmetry with every sibling
  // validator in this domain; TFact-level deep validation of individual
  // Demonstration Requirements is the translation function's own job
  // (mirrors Stage 2.5.i.14's own compiler doing the same, not this
  // contract's bare structural check).
  void isValidFact;
  return true;
}

// ---------------------------------------------------------------------------
// Translation output -- provider-independent. See file header for the
// "semantic facts, not cinematography" boundary.
// ---------------------------------------------------------------------------

export interface ProviderAdapterSemanticFact {
  category: DemonstrationRequirementCategory;
  value: string | boolean | number;
  sourceDemonstrationRequirementId: string;
}

function isValidProviderAdapterSemanticFact(value: unknown): value is ProviderAdapterSemanticFact {
  if (!isRecord(value)) return false;
  if (!isDemonstrationRequirementCategory(value.category)) return false;
  if (!("value" in value) || value.value === undefined) return false;
  if (typeof value.value !== "string" && typeof value.value !== "boolean" && typeof value.value !== "number") return false;
  if (typeof value.sourceDemonstrationRequirementId !== "string" || value.sourceDemonstrationRequirementId.length === 0) return false;
  return true;
}

export interface ProviderAdapterActionSegment {
  // 1-based, contiguous within one output's own `segments` array --
  // reuses VideoInstruction.order directly, never invented.
  order: number;
  sourceVideoInstructionId: string;
  sourceAtomicActionId: string;
  // Reused directly from the source VideoInstruction -- never re-derived,
  // never independently asserted (Stage 2.5.i.13's own evidence-status
  // discipline, extended here).
  evidenceStatus: AtomicActionEvidenceStatus;
  requiredVisibleFacts: readonly ProviderAdapterSemanticFact[];
  viewpointFamily: ViewpointFamily;
  framingSemantics: readonly FramingSemantic[];
  sourceViewpointConstraintIds: readonly string[];
}

export function isValidProviderAdapterActionSegment(value: unknown): value is ProviderAdapterActionSegment {
  if (!isRecord(value)) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (typeof value.sourceVideoInstructionId !== "string" || value.sourceVideoInstructionId.length === 0) return false;
  if (typeof value.sourceAtomicActionId !== "string" || value.sourceAtomicActionId.length === 0) return false;
  if (!isAtomicActionEvidenceStatus(value.evidenceStatus)) return false;

  if (!Array.isArray(value.requiredVisibleFacts) || value.requiredVisibleFacts.length === 0) return false;
  if (!value.requiredVisibleFacts.every(isValidProviderAdapterSemanticFact)) return false;

  if (!isViewpointFamily(value.viewpointFamily)) return false;

  if (!Array.isArray(value.framingSemantics) || value.framingSemantics.length === 0) return false;
  if (!value.framingSemantics.every(isFramingSemantic)) return false;

  if (!Array.isArray(value.sourceViewpointConstraintIds) || value.sourceViewpointConstraintIds.length === 0) return false;
  if (!value.sourceViewpointConstraintIds.every((id) => typeof id === "string" && id.length > 0)) return false;

  return true;
}

export interface ProviderAdapterTranslationOutput {
  generationIntent: ProviderAdapterGenerationIntent;
  // Open string, deliberately -- mirrors every other contract in this
  // family exactly.
  vertical: string;
  sealedRequestId: string;
  visualReference: ProviderAdapterVisualReference;
  // Ordered, one segment per source VideoInstruction -- the whole array
  // together represents exactly ONE grouped provider request (Stage
  // 2.5.i.21's own explicit "one request, never three" rule).
  segments: readonly ProviderAdapterActionSegment[];
}

export function isValidProviderAdapterTranslationOutput(value: unknown): value is ProviderAdapterTranslationOutput {
  if (!isRecord(value)) return false;
  if (!isProviderAdapterGenerationIntent(value.generationIntent)) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.sealedRequestId !== "string" || value.sealedRequestId.length === 0) return false;
  if (!isValidProviderAdapterVisualReference(value.visualReference)) return false;

  if (!Array.isArray(value.segments) || value.segments.length === 0) return false;
  if (!value.segments.every(isValidProviderAdapterActionSegment)) return false;

  const ids = value.segments.map((s: ProviderAdapterActionSegment) => s.sourceVideoInstructionId);
  if (new Set(ids).size !== ids.length) return false;

  const orders = value.segments.map((s: ProviderAdapterActionSegment) => s.order).sort((a: number, b: number) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  return true;
}
