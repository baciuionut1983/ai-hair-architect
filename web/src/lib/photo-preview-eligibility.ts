import { findCurrentConfirmedProposal } from "@/lib/proposal-repository";
import { findCurrentConfirmedMap } from "@/lib/technical-visual-map-repository";
import { listSpatialBindingsForMap } from "@/lib/technical-visual-map-spatial-binding-repository";
import { listPhotoPreviewGenerationsForBinding } from "@/lib/photo-preview-generation-repository";
import { PROPOSAL_VERTICALS } from "@/lib/proposal-validators";

// AI Concierge / Orchestrator -- Gap #3 (server-authoritative Photo Preview
// discovery). Composes ONLY existing, already-tested, owner+client-scoped
// repository reads -- this file invents no new persistence, no new query
// shape, and reuses the EXACT authority chain the Analysis page's own real
// UI already walks (Current Approved Look -> Technical Visual Map ->
// Spatial Mapping -> AI Photo Preview): current CONFIRMED proposal -> the
// map CONFIRMED under THAT specific proposal -> the spatial binding(s)
// CONFIRMED under THAT specific map -> any COMPLETED generation for one of
// THOSE specific bindings. Every step is anchored to its parent's own
// freshly-resolved id, never a bare "any confirmed X for this client"
// shortcut -- this is what makes a superseded proposal's own old map/
// binding/preview chain structurally unreachable through this function,
// with no extra "is this current" check needed anywhere.
//
// Deliberately client-scoped, not analysis-scoped: findCurrentConfirmedProposal
// itself is a per-client concept (mirrors orchestrator-plan-service.ts's own
// identical call) -- the caller (orchestrator-service.ts) is responsible for
// only invoking this once a real client AND a real analysis have both
// already resolved, matching the existing hasCompletedPhotoPreview gate.

const CUTTING_VERTICAL = PROPOSAL_VERTICALS[0];

export interface EligiblePhotoPreviewResult {
  eligible: boolean;
  // The real, persisted PhotoPreviewGeneration.id this eligibility answer
  // is about -- null whenever `eligible` is false. Exists so a caller can
  // track "was THIS SPECIFIC preview already offered" (presentation-layer
  // repetition suppression only -- never authority; see
  // orchestrator-service.ts's own header comment on this field).
  photoPreviewGenerationId: string | null;
}

const NOT_ELIGIBLE: EligiblePhotoPreviewResult = { eligible: false, photoPreviewGenerationId: null };

export interface FindEligibleCompletedPhotoPreviewDependencies {
  findCurrentConfirmedProposal?: typeof findCurrentConfirmedProposal;
  findCurrentConfirmedMap?: typeof findCurrentConfirmedMap;
  listSpatialBindingsForMap?: typeof listSpatialBindingsForMap;
  listPhotoPreviewGenerationsForBinding?: typeof listPhotoPreviewGenerationsForBinding;
}

// Eligible means exactly what the Analysis page's own PhotoPreviewHistoryList
// already treats as a real, displayable result: status COMPLETED and a
// real generatedImageAssetId (photo-preview-history.tsx's own render
// condition) -- FAILED/PROCESSING/REQUESTED are never eligible. Fails
// CLOSED on any read error (mirrors resolveVisualizeResultPlan's own
// identical try/catch around its confirmed-proposal read) -- a persistence
// hiccup is never treated as "eligible", only ever as "not yet", the same
// honest direction every other authority check in this domain already
// takes.
export async function findEligibleCompletedPhotoPreview(
  ownerUserId: string,
  clientId: string,
  dependencies: FindEligibleCompletedPhotoPreviewDependencies = {},
): Promise<EligiblePhotoPreviewResult> {
  const findProposal = dependencies.findCurrentConfirmedProposal ?? findCurrentConfirmedProposal;
  const findMap = dependencies.findCurrentConfirmedMap ?? findCurrentConfirmedMap;
  const listBindings = dependencies.listSpatialBindingsForMap ?? listSpatialBindingsForMap;
  const listGenerations = dependencies.listPhotoPreviewGenerationsForBinding ?? listPhotoPreviewGenerationsForBinding;

  try {
    const proposal = await findProposal(ownerUserId, clientId, CUTTING_VERTICAL);
    if (!proposal) return NOT_ELIGIBLE;

    const map = await findMap(ownerUserId, clientId, proposal.id, CUTTING_VERTICAL);
    if (!map) return NOT_ELIGIBLE;

    const bindings = await listBindings(ownerUserId, clientId, map.id);
    const confirmedBindings = bindings.filter((binding) => binding.status === "CONFIRMED");
    if (confirmedBindings.length === 0) return NOT_ELIGIBLE;

    // Multiple independent (image, view) scopes can each be CONFIRMED at
    // once (front, back, ...) -- any ONE of them having a real completed
    // result is enough; it does not matter which view.
    for (const binding of confirmedBindings) {
      const generations = await listGenerations(ownerUserId, clientId, binding.id);
      const completed = generations.find((generation) => generation.status === "COMPLETED" && generation.generatedImageAssetId !== null);
      if (completed) {
        return { eligible: true, photoPreviewGenerationId: completed.id };
      }
    }

    return NOT_ELIGIBLE;
  } catch {
    return NOT_ELIGIBLE;
  }
}
