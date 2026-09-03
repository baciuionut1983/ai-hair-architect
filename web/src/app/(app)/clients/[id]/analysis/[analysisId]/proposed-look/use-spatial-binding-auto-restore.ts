"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

import { resolveAutoRestoreSelection } from "./spatial-binding-logic";

// Spatial Mapping revisit fix #1 (real production defect): SpatialBindingSection's
// own (selectedImageId, selectedViewLabel) starts null on every mount, even
// when a real CONFIRMED spatial binding already exists -- see
// spatial-binding-logic.ts's own resolveAutoRestoreSelection doc comment for
// the full rationale. This hook owns ONLY the one-shot fetch and WHEN to
// apply its result; WHICH scope to restore is a pure decision, fully
// unit-tested without React, in resolveAutoRestoreSelection itself.
//
// Reuses the EXISTING, already-tested, read-only GET .../spatial-bindings
// endpoint (the SAME one useSpatialBinding's own history fetch already
// calls once a selection exists) -- no new API route, no new repository
// query beyond fix #1's own pure selection logic.
//
// MANUAL CHOICE ALWAYS WINS (required behavior, not incidental): both
// setters below are called with a FUNCTIONAL updater
// (`current => current ?? restored...`), read at APPLY time, not with the
// value captured when the fetch started -- so if the professional makes a
// real selection while this fetch is still in flight, `current` is already
// non-null by the time the restore would apply, and the functional update
// is a no-op. This is a real race, not a theoretical one (the dropdowns are
// interactive immediately, before this fetch can possibly resolve).
export function useSpatialBindingAutoRestore(
  clientId: string,
  proposalId: string,
  technicalVisualMapId: string,
  setSelectedImageId: Dispatch<SetStateAction<string | null>>,
  setSelectedViewLabel: Dispatch<SetStateAction<string | null>>,
): void {
  // One-shot per mount -- set to true BEFORE the async call starts (not
  // inside the .then continuation) so React StrictMode's dev-only double
  // effect invocation can never fire two overlapping fetches, and so a
  // dependency-array re-run (a genuinely different map, in practice always
  // a fresh mount anyway -- see spatial-binding-section.tsx's own `key`)
  // never re-attempts a restore that has already had its one chance.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/technical-visual-maps/${technicalVisualMapId}/spatial-bindings`,
        );
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { bindings: TechnicalVisualMapSpatialBindingRecord[] };
        if (cancelled) return;

        const restored = resolveAutoRestoreSelection(body.bindings);
        if (!restored) return;

        setSelectedImageId((current) => current ?? restored.sourceImageAssetId);
        setSelectedViewLabel((current) => current ?? restored.viewLabel);
      } catch {
        // Best-effort restore only -- a failed fetch leaves the professional
        // exactly where they already are today (an empty, manually-fillable
        // selection), never a blocking error for a convenience feature.
      }
    })();

    return () => {
      cancelled = true;
    };
    // setSelectedImageId/setSelectedViewLabel are the raw useState setters
    // from the caller (referentially stable by React's own guarantee) --
    // only a genuine scope change should ever re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, proposalId, technicalVisualMapId]);
}
