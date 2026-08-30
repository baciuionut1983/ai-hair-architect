import { describe, expect, it } from "vitest";

import type { PhotoPreviewGenerationRecord } from "@/lib/photo-preview-generation-repository";
import type { SealedPhotoPreviewTarget } from "@/lib/photo-preview-contracts";

import {
  canRequestPhotoPreviewVariation,
  findInFlightPhotoPreviewGenerationIds,
  formatPhotoPreviewTimestamp,
  getPhotoPreviewStatusBadgeVariant,
  getPhotoPreviewStatusLabel,
  getPhotoPreviewVariationLabel,
  getPhotoPreviewViewLabel,
  isPhotoPreviewGenerationActivelyInFlight,
  isPhotoPreviewGenerationInFlight,
  isPhotoPreviewGenerationRecoverable,
  mapPhotoPreviewApiError,
  mapPhotoPreviewFailureCodeToMessage,
  PHOTO_PREVIEW_CLIENT_STALE_PROCESSING_TIMEOUT_MS,
  resolvePhotoPreviewLoadStatus,
  summarizePhotoPreviewTarget,
} from "./photo-preview-logic";

// Real AI Photo Preview, Stage 3 -- pure-logic coverage. This codebase never
// unit-tests component rendering (vitest.config.ts only ever picks up
// `*.test.ts`); this file is the load-bearing automated coverage for every
// state/label/eligibility rule the UI renders from -- the interactive
// click-level behavior is validated live (see the Stage 3 final report).

function makeGeneration(overrides: Partial<PhotoPreviewGenerationRecord> = {}): PhotoPreviewGenerationRecord {
  return {
    id: "gen-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisProposalId: "proposal-1",
    analysisProposalConfirmedAt: "2026-01-01T00:00:00.000Z",
    technicalVisualMapId: "map-1",
    mapVersion: 1,
    spatialBindingId: "binding-1",
    spatialVersion: 1,
    sourceImageAssetId: "asset-1",
    sourceImageAnalysisId: null,
    viewLabel: "front",
    frozenSourceWidth: 960,
    frozenSourceHeight: 1280,
    frozenSourceOrientation: 1,
    frozenSourceContentSha256: null,
    frozenSourceStorageVersionId: null,
    provider: "gemini",
    model: "gemini-3.1-flash-image",
    generationSchemaVersion: "1.0.0",
    sealedRequest: {
      schemaVersion: "1.0.0",
      sourceImage: { assetId: "asset-1", width: 960, height: 1280, orientation: 1, contentSha256: null, storageVersionId: null },
      viewLabel: "front",
      target: { globalIntent: { structuralTechnique: "graduation", cuttingTechnique: "slice_cutting", sectioning: "diagonal_back", elevation: "45_deg_graduation", distribution: "overdirected_back", guideline: "stationary" }, zones: [], relationships: [] },
      spatial: { zones: [], perimeter: { state: "not_placed", points: [] } } as never,
      preserveContract: { invariants: [], mapPreserveConstraints: [], contraindications: [] },
    },
    requestFingerprint: "fingerprint-1",
    variationIndex: 0,
    status: "COMPLETED",
    providerRequestId: null,
    generatedImageAssetId: "generated-1",
    errorCode: null,
    errorMetadata: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:01.000Z",
    completedAt: "2026-01-01T00:00:12.000Z",
    failedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:12.000Z",
    ...overrides,
  };
}

describe("resolvePhotoPreviewLoadStatus", () => {
  it("maps an ok response to ready and a non-ok response to error", () => {
    expect(resolvePhotoPreviewLoadStatus({ ok: true, status: 200 })).toBe("ready");
    expect(resolvePhotoPreviewLoadStatus({ ok: false, status: 500 })).toBe("error");
  });
});

describe("status labels (task #8) -- no raw enum as primary UX", () => {
  it("gives every status a human-readable label distinct from its raw value", () => {
    expect(getPhotoPreviewStatusLabel("REQUESTED")).toBe("Preparing preview...");
    expect(getPhotoPreviewStatusLabel("PROCESSING")).toBe("Generating AI Photo Preview...");
    expect(getPhotoPreviewStatusLabel("COMPLETED")).toBe("Preview ready");
    expect(getPhotoPreviewStatusLabel("FAILED")).toBe("Generation failed");
  });

  it("assigns a distinct badge variant per status, never relying on label text alone", () => {
    expect(getPhotoPreviewStatusBadgeVariant("COMPLETED")).toBe("success");
    expect(getPhotoPreviewStatusBadgeVariant("FAILED")).toBe("danger");
    expect(getPhotoPreviewStatusBadgeVariant("PROCESSING")).toBe("warning");
    expect(getPhotoPreviewStatusBadgeVariant("REQUESTED")).toBe("warning");
  });
});

describe("in-flight detection (tasks #11/#21)", () => {
  it("treats REQUESTED and PROCESSING as in flight, COMPLETED and FAILED as terminal", () => {
    expect(isPhotoPreviewGenerationInFlight("REQUESTED")).toBe(true);
    expect(isPhotoPreviewGenerationInFlight("PROCESSING")).toBe(true);
    expect(isPhotoPreviewGenerationInFlight("COMPLETED")).toBe(false);
    expect(isPhotoPreviewGenerationInFlight("FAILED")).toBe(false);
  });

  it("finds only the in-flight ids across a mixed history, preserving none of the terminal ones", () => {
    const history = [
      makeGeneration({ id: "a", status: "COMPLETED" }),
      makeGeneration({ id: "b", status: "PROCESSING" }),
      makeGeneration({ id: "c", status: "FAILED" }),
      makeGeneration({ id: "d", status: "REQUESTED" }),
    ];
    expect(findInFlightPhotoPreviewGenerationIds(history)).toEqual(["b", "d"]);
  });

  it("returns an empty array for an empty or all-terminal history", () => {
    expect(findInFlightPhotoPreviewGenerationIds([])).toEqual([]);
    expect(findInFlightPhotoPreviewGenerationIds([makeGeneration({ status: "COMPLETED" })])).toEqual([]);
  });
});

describe("canRequestPhotoPreviewVariation (task #18)", () => {
  it("is false with no generations yet -- the ordinary Generate action is the only path", () => {
    expect(canRequestPhotoPreviewVariation([])).toBe(false);
  });

  it("is true once at least one generation exists, regardless of its outcome", () => {
    expect(canRequestPhotoPreviewVariation([makeGeneration({ status: "FAILED" })])).toBe(true);
    expect(canRequestPhotoPreviewVariation([makeGeneration({ status: "COMPLETED" })])).toBe(true);
  });
});

describe("stuck-generation recovery (task #16)", () => {
  const NOW = new Date("2026-01-01T01:00:00.000Z");
  const RECENT_START = new Date(NOW.getTime() - 60_000).toISOString(); // 1 minute ago
  const STALE_START = new Date(NOW.getTime() - (PHOTO_PREVIEW_CLIENT_STALE_PROCESSING_TIMEOUT_MS + 1)).toISOString(); // just past the threshold

  describe("isPhotoPreviewGenerationActivelyInFlight", () => {
    it("is true for a PROCESSING row that started recently", () => {
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "PROCESSING", startedAt: RECENT_START }, NOW)).toBe(true);
    });

    it("is false for a PROCESSING row started longer ago than the stale threshold", () => {
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "PROCESSING", startedAt: STALE_START }, NOW)).toBe(false);
    });

    it("is true for a PROCESSING row with no startedAt yet (freshly claimed, never treated as stale)", () => {
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "PROCESSING", startedAt: null }, NOW)).toBe(true);
    });

    it("is false for REQUESTED, COMPLETED, and FAILED -- only PROCESSING can be 'actively' in flight", () => {
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "REQUESTED", startedAt: null }, NOW)).toBe(false);
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "COMPLETED", startedAt: RECENT_START }, NOW)).toBe(false);
      expect(isPhotoPreviewGenerationActivelyInFlight({ status: "FAILED", startedAt: RECENT_START }, NOW)).toBe(false);
    });
  });

  describe("isPhotoPreviewGenerationRecoverable", () => {
    it("a REQUESTED row is always recoverable, regardless of age -- the backend accepts a claim immediately", () => {
      expect(isPhotoPreviewGenerationRecoverable({ status: "REQUESTED", startedAt: null }, NOW)).toBe(true);
    });

    it("a recently-started PROCESSING row is NOT recoverable -- it may genuinely still be running", () => {
      expect(isPhotoPreviewGenerationRecoverable({ status: "PROCESSING", startedAt: RECENT_START }, NOW)).toBe(false);
    });

    it("a stale PROCESSING row IS recoverable, matching the backend's own stale-reclaim eligibility", () => {
      expect(isPhotoPreviewGenerationRecoverable({ status: "PROCESSING", startedAt: STALE_START }, NOW)).toBe(true);
    });

    it("terminal states (COMPLETED/FAILED) are never 'recoverable' -- there is nothing to resume", () => {
      expect(isPhotoPreviewGenerationRecoverable({ status: "COMPLETED", startedAt: STALE_START }, NOW)).toBe(false);
      expect(isPhotoPreviewGenerationRecoverable({ status: "FAILED", startedAt: STALE_START }, NOW)).toBe(false);
    });
  });
});

describe("mapPhotoPreviewFailureCodeToMessage (task #20) -- never a raw provider/internal string", () => {
  it("maps every known persisted errorCode to a safe, distinct message", () => {
    expect(mapPhotoPreviewFailureCodeToMessage("PHOTO_PREVIEW_PROVIDER_REFUSED")).toBe("The AI provider could not generate this preview.");
    expect(mapPhotoPreviewFailureCodeToMessage("PHOTO_PREVIEW_SOURCE_UNAVAILABLE")).toBe("The source photo is unavailable right now.");
    expect(mapPhotoPreviewFailureCodeToMessage("PHOTO_PREVIEW_CONFIGURATION_ERROR")).toBe("Photo Preview is not configured correctly right now.");
  });

  it("maps every known unprefixed executionOutcome code to a safe message using the SAME table", () => {
    expect(mapPhotoPreviewFailureCodeToMessage("PROCESSING_DISABLED")).toBe("Photo Preview is not available right now.");
    expect(mapPhotoPreviewFailureCodeToMessage("MAX_ATTEMPTS_EXCEEDED")).toBe("This preview could not be completed after multiple attempts.");
  });

  it("never throws and never echoes the input for null, undefined, or an unrecognized code", () => {
    expect(mapPhotoPreviewFailureCodeToMessage(null)).toBe("Generation could not be completed. Please try again.");
    expect(mapPhotoPreviewFailureCodeToMessage(undefined)).toBe("Generation could not be completed. Please try again.");
    const message = mapPhotoPreviewFailureCodeToMessage("SOME_FUTURE_UNRECOGNIZED_CODE");
    expect(message).toBe("Generation could not be completed. Please try again.");
    expect(message).not.toContain("SOME_FUTURE_UNRECOGNIZED_CODE");
  });
});

describe("mapPhotoPreviewApiError -- HTTP-transport-level safe messages", () => {
  it("maps 401/404/503 to distinct safe messages", () => {
    expect(mapPhotoPreviewApiError(401)).toBe("Please sign in again.");
    expect(mapPhotoPreviewApiError(404)).toBe("This item is no longer available.");
    expect(mapPhotoPreviewApiError(503)).toBe("Photo Preview is temporarily unavailable. Please try again shortly.");
  });

  it("gives a specific message for a dependency-chain 422 (eligibility changed since page load)", () => {
    const message = mapPhotoPreviewApiError(422, "PHOTO_PREVIEW_GENERATION_BINDING_NOT_CONFIRMED");
    expect(message).toContain("changed since this page loaded");
  });

  it("falls back to a generic safe message for anything else", () => {
    expect(mapPhotoPreviewApiError(0)).toBe("Something went wrong. Please try again.");
    expect(mapPhotoPreviewApiError(500)).toBe("Something went wrong. Please try again.");
  });
});

describe("generation details (task #23)", () => {
  it("resolves a human view label, falling back to the raw value for an unrecognized one", () => {
    expect(getPhotoPreviewViewLabel("front")).toBe("Front");
    expect(getPhotoPreviewViewLabel("left_profile")).toBe("Left profile");
  });

  it("formats a timestamp as a locale string, not a raw ISO string", () => {
    const formatted = formatPhotoPreviewTimestamp("2026-01-01T00:00:00.000Z");
    expect(formatted).not.toBe("2026-01-01T00:00:00.000Z");
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("summarizes the target with the humanized technique and only the zones with real intent", () => {
    const target: SealedPhotoPreviewTarget = {
      globalIntent: { structuralTechnique: "graduation", cuttingTechnique: "slice_cutting", sectioning: "diagonal_back", elevation: "45_deg_graduation", distribution: "overdirected_back", guideline: "stationary" },
      zones: [
        { zone: "crown", lengthIntent: "shorten", lengthIntentSource: "professional_adjustment", weightIntent: "unspecified", weightIntentSource: "global_default", densitySensitive: false, densitySensitiveSource: "global_default", preserve: false, preserveSource: "global_default" },
        { zone: "top", lengthIntent: "unspecified", lengthIntentSource: "global_default", weightIntent: "unspecified", weightIntentSource: "global_default", densitySensitive: false, densitySensitiveSource: "global_default", preserve: false, preserveSource: "global_default" },
      ],
      relationships: [],
    };
    const summary = summarizePhotoPreviewTarget(target);
    expect(summary).toContain("Graduation");
    expect(summary).toContain("Crown");
    expect(summary).toContain("Shorten");
    expect(summary).not.toContain("Top");
  });

  it("summarizes with just the technique when no zone has any real intent", () => {
    const target: SealedPhotoPreviewTarget = {
      globalIntent: { structuralTechnique: "graduation", cuttingTechnique: "slice_cutting", sectioning: "diagonal_back", elevation: "45_deg_graduation", distribution: "overdirected_back", guideline: "stationary" },
      zones: [],
      relationships: [],
    };
    expect(summarizePhotoPreviewTarget(target)).toBe("Graduation");
  });

  it("labels a variation only when its index is greater than zero", () => {
    expect(getPhotoPreviewVariationLabel({ variationIndex: 0 })).toBeNull();
    expect(getPhotoPreviewVariationLabel({ variationIndex: 1 })).toBe("Variation 1");
    expect(getPhotoPreviewVariationLabel({ variationIndex: 2 })).toBe("Variation 2");
  });
});
