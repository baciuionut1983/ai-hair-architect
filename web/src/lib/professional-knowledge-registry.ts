import { createHash } from "crypto";

import type { AtomicActionStateTransition } from "@/lib/professional-skill-atomic-action-contracts";
import type { ProfessionalKnowledgeEntry } from "@/lib/professional-knowledge-entry-contracts";
import { buildRealProfessionalKnowledgeEntries } from "@/lib/professional-knowledge-activation-l5r3-6-manifest";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 --
// PROFESSIONAL KNOWLEDGE REGISTRY. Pure, deterministic, no I/O, no
// database, ZERO AI calls. Mirrors professional-brain-skill-templates.ts's
// own exact, already-proven precedent: a CODE-BASED, in-memory,
// deterministically-derived registry, not a DB-backed one -- that file's
// own header explains why (the real runtime brain/compiler reads the
// in-memory registry today; a parallel DB table for SkillDefinition
// exists but is never populated by any of this codebase's 7 active
// skills). The SAME reasoning applies here with even more force: nothing
// anywhere reads ProfessionalKnowledgeEntry from a database today, so
// adding a Prisma model/migration for it now would be exactly the
// "architectural fashion" this stage's own task explicitly warns
// against, not a genuine current need. ONE coherent brain: this file's
// own registry is meant to be queried ALONGSIDE
// buildCanonicalCandidateSkillRegistry() (professional-brain-skill-
// templates.ts), never as a second, competing authority -- see this
// stage's own acceptance test for a query spanning both.
//
// This file performs ZERO database writes and ZERO local DB reads --
// buildRealProfessionalKnowledgeEntries() is itself a pure function over
// already-in-memory, already-approved data (professional-knowledge-
// assimilation-l5r3-4-real-plan.ts's own real plan +
// professional-knowledge-review-l5r3-2-real-decisions.ts's own real
// decisions, both pure, both unmodified).

export function buildActiveProfessionalKnowledgeRegistry(): readonly ProfessionalKnowledgeEntry[] {
  return buildRealProfessionalKnowledgeEntries();
}

// ---------------------------------------------------------------------
// Deterministic fingerprint / snapshot -- mirrors computeRegistryContextHash's
// own exact canonical-sort-then-hash precedent (professional-knowledge-
// registry-comparison.ts).
// ---------------------------------------------------------------------

export function computeProfessionalKnowledgeRegistryFingerprint(entries: readonly ProfessionalKnowledgeEntry[]): string {
  const canonical = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export type KnowledgeSnapshotCategory =
  | "ACTIVE_TECHNIQUE_IDENTITY"
  | "ACTIVE_PURPOSE"
  | "ACTIVE_EFFECT_RELATIONSHIP"
  | "ACTIVE_WORKFLOW"
  | "ACTIVE_CONTEXTUAL_KNOWLEDGE"
  | "ACTIVE_EVIDENCE_SUPPORT"
  | "APPROVED_BUT_UNATTACHED"
  | "UNKNOWN";

const KIND_TO_CATEGORY: Record<ProfessionalKnowledgeEntry["kind"], KnowledgeSnapshotCategory> = {
  TECHNIQUE_IDENTITY: "ACTIVE_TECHNIQUE_IDENTITY",
  TECHNIQUE_PURPOSE: "ACTIVE_PURPOSE",
  EFFECT_RELATIONSHIP: "ACTIVE_EFFECT_RELATIONSHIP",
  WORKFLOW_TRANSITION: "ACTIVE_WORKFLOW",
  CONTEXTUAL_KNOWLEDGE: "ACTIVE_CONTEXTUAL_KNOWLEDGE",
  EVIDENCE_SUPPORT: "ACTIVE_EVIDENCE_SUPPORT",
  PENDING_OBSERVATION: "APPROVED_BUT_UNATTACHED",
};

export interface KnowledgeSnapshotSummary {
  readonly totalEntries: number;
  readonly countsByCategory: Readonly<Record<KnowledgeSnapshotCategory, number>>;
  readonly fingerprint: string;
}

export function summarizeProfessionalKnowledgeSnapshot(entries: readonly ProfessionalKnowledgeEntry[]): KnowledgeSnapshotSummary {
  const countsByCategory: Record<KnowledgeSnapshotCategory, number> = {
    ACTIVE_TECHNIQUE_IDENTITY: 0,
    ACTIVE_PURPOSE: 0,
    ACTIVE_EFFECT_RELATIONSHIP: 0,
    ACTIVE_WORKFLOW: 0,
    ACTIVE_CONTEXTUAL_KNOWLEDGE: 0,
    ACTIVE_EVIDENCE_SUPPORT: 0,
    APPROVED_BUT_UNATTACHED: 0,
    UNKNOWN: 0,
  };
  for (const entry of entries) {
    // status is the authority on APPROVED_BUT_UNATTACHED regardless of
    // kind (PENDING_OBSERVATION is the only kind that can carry it, but
    // this stays honest even if a future kind ever legitimately does
    // too -- see professional-knowledge-entry-contracts.ts's own status
    // field, which is NOT type-locked for the other six kinds).
    const category = entry.status === "APPROVED_BUT_UNATTACHED" ? "APPROVED_BUT_UNATTACHED" : KIND_TO_CATEGORY[entry.kind];
    countsByCategory[category] += 1;
  }
  return { totalEntries: entries.length, countsByCategory, fingerprint: computeProfessionalKnowledgeRegistryFingerprint(entries) };
}

// ---------------------------------------------------------------------
// Deterministic queries -- NO LLM, NO provider, plain structural
// filters. Every query is explicitly gated on status === "ACTIVE" (or,
// for Query F, the opposite) -- an APPROVED_BUT_UNATTACHED entry can
// NEVER be returned by an "ACTIVE knowledge" query, structurally
// enforced here, not by convention.
// ---------------------------------------------------------------------

// Query A: "What professional purposes can <technique> serve?"
export function queryTechniquePurposes(entries: readonly ProfessionalKnowledgeEntry[], techniqueId: string): readonly string[] {
  return entries.filter((e) => e.status === "ACTIVE" && e.kind === "TECHNIQUE_PURPOSE" && e.payload.techniqueId === techniqueId).map((e) => (e.kind === "TECHNIQUE_PURPOSE" ? e.payload.purpose : ""));
}

// Query B: "What techniques may produce <effect>?"
export function queryTechniquesByEffect(entries: readonly ProfessionalKnowledgeEntry[], effect: string): readonly string[] {
  const match = entries.find((e) => e.status === "ACTIVE" && e.kind === "EFFECT_RELATIONSHIP" && e.payload.effect === effect);
  return match && match.kind === "EFFECT_RELATIONSHIP" ? match.payload.relatedTechniqueIds : [];
}

// Query C: "What workflow transition is known after <fromValue>?"
export function queryWorkflowTransitionsFrom(entries: readonly ProfessionalKnowledgeEntry[], fromValue: string): readonly AtomicActionStateTransition[] {
  return entries
    .filter((e) => e.status === "ACTIVE" && e.kind === "WORKFLOW_TRANSITION" && e.payload.transition.fromValue === fromValue)
    .map((e) => (e.kind === "WORKFLOW_TRANSITION" ? e.payload.transition : { fact: "", toValue: "" }));
}

// Query D: "What professional evidence supports <targetSkillId>?"
export function queryEvidenceSupportingSkill(entries: readonly ProfessionalKnowledgeEntry[], targetSkillId: string): readonly ProfessionalKnowledgeEntry[] {
  return entries.filter((e) => e.status === "ACTIVE" && e.kind === "EVIDENCE_SUPPORT" && e.payload.targetSkillId === targetSkillId);
}

// Query E: "What is commonly used on <subject>?" -- returns the
// techniqueIds + the real ContextualPreferenceRelation, NEVER promoted
// to a requirement.
export function queryContextualKnowledgeBySubject(entries: readonly ProfessionalKnowledgeEntry[], subjectSubstring: string): readonly { techniqueId: string; relation: string; subject: string }[] {
  return entries
    .filter((e) => e.status === "ACTIVE" && e.kind === "CONTEXTUAL_KNOWLEDGE" && e.payload.claim.subject.includes(subjectSubstring))
    .map((e) => (e.kind === "CONTEXTUAL_KNOWLEDGE" ? { techniqueId: e.payload.techniqueId, relation: e.payload.claim.relation, subject: e.payload.claim.subject } : { techniqueId: "", relation: "", subject: "" }));
}

// Query F: "What knowledge is professionally approved but not safely attached?"
export function queryApprovedButUnattached(entries: readonly ProfessionalKnowledgeEntry[]): readonly ProfessionalKnowledgeEntry[] {
  return entries.filter((e) => e.status === "APPROVED_BUT_UNATTACHED");
}
