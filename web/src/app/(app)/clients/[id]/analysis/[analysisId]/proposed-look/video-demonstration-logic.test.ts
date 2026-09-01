import { describe, expect, it } from "vitest";

import type { VideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";

import {
  formatVideoDemonstrationTimestamp,
  getVideoDemonstrationStatusBadgeVariant,
  getVideoDemonstrationStatusLabel,
  isVideoDemonstrationInFlight,
  mapVideoDemonstrationApiError,
  resolveLatestVideoDemonstration,
  videoAssetContentUrl,
} from "./video-demonstration-logic";

// Video UI, Result Visualization -- pure-logic coverage. This codebase
// never unit-tests component rendering (vitest.config.ts only ever picks
// up `*.test.ts`); this file is the load-bearing automated coverage for
// every state/label/eligibility rule the UI renders from -- the
// interactive click-level behavior is validated live (see this stage's
// own final report), mirroring photo-preview-logic.test.ts's own exact
// convention.

function makeView(overrides: Partial<VideoDemonstrationStatusView> = {}): VideoDemonstrationStatusView {
  return {
    id: "gen-1",
    photoPreviewGenerationId: "pp-1",
    clientId: "client-1",
    status: "REQUESTED",
    variationIndex: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    processingStartedAt: null,
    completedAt: null,
    failedAt: null,
    failureMessage: null,
    resultAsset: null,
    retryEligible: false,
    ...overrides,
  };
}

describe("status labels / badge variants", () => {
  it("every status has a human, non-raw label", () => {
    expect(getVideoDemonstrationStatusLabel("REQUESTED")).toBe("Preparing your video...");
    expect(getVideoDemonstrationStatusLabel("PROCESSING")).toBe("Generating your result video...");
    expect(getVideoDemonstrationStatusLabel("COMPLETED")).toBe("Video ready");
    expect(getVideoDemonstrationStatusLabel("FAILED")).toBe("Video could not be generated");
  });

  it("badge variants: success for COMPLETED, danger for FAILED, warning for in-flight", () => {
    expect(getVideoDemonstrationStatusBadgeVariant("COMPLETED")).toBe("success");
    expect(getVideoDemonstrationStatusBadgeVariant("FAILED")).toBe("danger");
    expect(getVideoDemonstrationStatusBadgeVariant("PROCESSING")).toBe("warning");
    expect(getVideoDemonstrationStatusBadgeVariant("REQUESTED")).toBe("warning");
  });
});

describe("isVideoDemonstrationInFlight", () => {
  it("REQUESTED and PROCESSING are in flight; COMPLETED and FAILED are not", () => {
    expect(isVideoDemonstrationInFlight("REQUESTED")).toBe(true);
    expect(isVideoDemonstrationInFlight("PROCESSING")).toBe(true);
    expect(isVideoDemonstrationInFlight("COMPLETED")).toBe(false);
    expect(isVideoDemonstrationInFlight("FAILED")).toBe(false);
  });
});

describe("mapVideoDemonstrationApiError", () => {
  it("maps known HTTP statuses to safe, specific messages", () => {
    expect(mapVideoDemonstrationApiError(401)).toBe("Please sign in again.");
    expect(mapVideoDemonstrationApiError(404)).toBe("This item is no longer available.");
    expect(mapVideoDemonstrationApiError(503)).toBe("Video generation is not available right now. Please try again later.");
    expect(mapVideoDemonstrationApiError(0)).toBe("Could not reach the server. Please check your connection and try again.");
  });

  it("a 422 with a VIDEO_DEMONSTRATION_GENERATION_ code gets a specific, actionable message", () => {
    expect(mapVideoDemonstrationApiError(422, "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_COMPLETED")).toContain("changed since this page loaded");
  });

  it("a 422 with an unrelated/no code gets the generic 422 message", () => {
    expect(mapVideoDemonstrationApiError(422)).toBe("This request could not be completed with the current data. Please review and try again.");
  });

  it("an unrecognized status falls back to a generic safe message -- never leaks the raw status/code", () => {
    const message = mapVideoDemonstrationApiError(500, "SOME_INTERNAL_DETAIL");
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toContain("SOME_INTERNAL_DETAIL");
  });
});

describe("formatVideoDemonstrationTimestamp / videoAssetContentUrl", () => {
  it("formats an ISO timestamp as a locale string", () => {
    expect(typeof formatVideoDemonstrationTimestamp("2026-09-01T10:00:00.000Z")).toBe("string");
  });

  it("builds the durable content URL from an assetId, never a provider URL shape", () => {
    expect(videoAssetContentUrl("asset-123")).toBe("/api/v1/video-assets/asset-123/content");
  });
});

describe("resolveLatestVideoDemonstration", () => {
  it("returns null for an empty history", () => {
    expect(resolveLatestVideoDemonstration([])).toBeNull();
  });

  it("returns the FIRST entry -- the backend's own newest-first ordering is never re-sorted client-side", () => {
    const newest = makeView({ id: "gen-2" });
    const older = makeView({ id: "gen-1" });
    expect(resolveLatestVideoDemonstration([newest, older])).toBe(newest);
  });
});
