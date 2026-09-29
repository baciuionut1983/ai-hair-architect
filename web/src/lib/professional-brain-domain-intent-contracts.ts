// AI Hair Architect -- Professional Brain DOMAIN INTENT contract.
// "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 1. Pure types +
// validators, zero I/O, zero professional/haircut/chemical logic --
// mirrors this codebase's own Stage 1 "pure contract" precedent
// (professional-skill-contracts.ts, hair-state-snapshot-validators.ts:
// closed vocabulary + a plain type-guard, nothing else).
//
// Models WHICH service domain(s) a single Professional Brain evaluation
// covers -- CUT, COLOR, and/or STYLING, any non-empty, duplicate-free
// combination the professional selects BEFORE the CURRENT/TARGET forms.
// Deliberately standalone (no dependency on hair-state-snapshot-
// validators.ts or any DB/route module) so the EXACT SAME contract can be
// reused, unchanged, by a future AI Concierge deciding which domains a
// client's own request spans -- not re-derived per caller. Where this
// intent is persisted (embedded in HairStateSnapshotPayload, see that
// file's own `evaluationDomainIntent` field) and how it is enforced
// (professional-brain-orchestrator.ts's own domain-scoped selection) are
// SEPARATE, later concerns -- this file only defines what a valid domain
// intent IS.

export const PROFESSIONAL_BRAIN_DOMAINS = ["cut", "color", "styling"] as const;
export type ProfessionalBrainDomain = (typeof PROFESSIONAL_BRAIN_DOMAINS)[number];

export function isProfessionalBrainDomain(value: unknown): value is ProfessionalBrainDomain {
  return typeof value === "string" && (PROFESSIONAL_BRAIN_DOMAINS as readonly string[]).includes(value);
}

export interface ProfessionalBrainDomainIntent {
  readonly domains: readonly ProfessionalBrainDomain[];
}

// A valid intent: a non-empty array, every entry a real domain, no
// duplicates. Order is not significant -- callers that need a stable
// order use PROFESSIONAL_BRAIN_DOMAINS's own canonical ordering (see
// sortDomains below), never the order the professional happened to click.
export function isValidProfessionalBrainDomainIntent(value: unknown): value is ProfessionalBrainDomainIntent {
  if (typeof value !== "object" || value === null) return false;
  const domains = (value as { domains?: unknown }).domains;
  if (!Array.isArray(domains) || domains.length === 0) return false;
  if (!domains.every(isProfessionalBrainDomain)) return false;
  return new Set(domains).size === domains.length;
}

export function sortDomains(domains: readonly ProfessionalBrainDomain[]): readonly ProfessionalBrainDomain[] {
  return PROFESSIONAL_BRAIN_DOMAINS.filter((d) => domains.includes(d));
}

export function hasDomain(intent: ProfessionalBrainDomainIntent | null | undefined, domain: ProfessionalBrainDomain): boolean {
  return intent?.domains.includes(domain) ?? false;
}

// STYLING has no engine yet -- no delta computation, no skill registry,
// no capability vocabulary (see requirement 2's own report, professional-
// brain-styling-gap.ts). A domain intent that includes it is still a
// VALID, selectable intent (STYLING is a real product option) -- this
// only flags that a caller computing a real CUT/COLOR-style result must
// stop honestly instead, never silently drop it or fabricate a result.
export function includesUnimplementedDomain(intent: ProfessionalBrainDomainIntent): boolean {
  return intent.domains.includes("styling");
}

// Legacy fallback -- every CURRENT snapshot created before this
// requirement existed has no `evaluationDomainIntent` at all. Defaulting
// those to CUT+COLOR exactly reproduces this app's own pre-existing
// composed behavior (selectMultiDomainCandidateSkills), so an old,
// already-confirmed evaluation is never reinterpreted as narrower than it
// actually was.
export const DEFAULT_PROFESSIONAL_BRAIN_DOMAIN_INTENT: ProfessionalBrainDomainIntent = { domains: ["cut", "color"] };
