import { describe, expect, it } from "vitest";

import type {
  ClientPhotoRecord,
  ClientTimelineResponse,
  ConsultationRecord,
  FormulaRecord,
  TreatmentRecord,
} from "@/lib/contracts";

import { buildHistoryStateFromTimeline, isClientHistoryEmpty } from "./client-history-logic";

function consultation(overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    id: "consultation-1",
    clientId: "client-1",
    analysisId: "analysis-1",
    summary: "Balayage with a gloss refresh.",
    nextSteps: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function photo(overrides: Partial<ClientPhotoRecord> = {}): ClientPhotoRecord {
  return {
    id: "photo-1",
    clientId: "client-1",
    imageUrl: "https://example.com/photo.jpg",
    caption: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function formula(overrides: Partial<FormulaRecord> = {}): FormulaRecord {
  return {
    id: "formula-1",
    clientId: "client-1",
    formulaName: "Root touch-up",
    formulaDetails: "6N + 20vol, 35 min",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function treatment(overrides: Partial<TreatmentRecord> = {}): TreatmentRecord {
  return {
    id: "treatment-1",
    clientId: "client-1",
    treatmentName: "Bond repair",
    treatmentDetails: "Single session",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function timelinePayload(overrides: Partial<ClientTimelineResponse> = {}): ClientTimelineResponse {
  return {
    photos: [],
    formulas: [],
    treatments: [],
    consultations: [],
    appointments: [],
    timeline: [],
    ...overrides,
  };
}

describe("isClientHistoryEmpty", () => {
  it("is true when every category is empty", () => {
    expect(isClientHistoryEmpty([], [], [], [])).toBe(true);
  });

  it("is false when only a consultation exists -- the exact bug: a saved consultation with no photos/formulas/treatments must not show as empty", () => {
    expect(isClientHistoryEmpty([], [], [], [consultation()])).toBe(false);
  });

  it("is false when only photos exist (pre-existing behavior preserved)", () => {
    expect(isClientHistoryEmpty([photo()], [], [], [])).toBe(false);
  });

  it("is false when only formulas exist (pre-existing behavior preserved)", () => {
    expect(isClientHistoryEmpty([], [formula()], [], [])).toBe(false);
  });

  it("is false when only treatments exist (pre-existing behavior preserved)", () => {
    expect(isClientHistoryEmpty([], [], [treatment()], [])).toBe(false);
  });

  it("is false when every category has entries", () => {
    expect(isClientHistoryEmpty([photo()], [formula()], [treatment()], [consultation()])).toBe(false);
  });
});

describe("buildHistoryStateFromTimeline", () => {
  it("carries consultations through from the timeline payload, never dropping them", () => {
    const payload = timelinePayload({ consultations: [consultation()] });
    expect(buildHistoryStateFromTimeline(payload).consultations).toEqual([consultation()]);
  });

  it("carries photos, formulas, and treatments through unchanged", () => {
    const payload = timelinePayload({
      photos: [photo()],
      formulas: [formula()],
      treatments: [treatment()],
    });
    const result = buildHistoryStateFromTimeline(payload);
    expect(result.photos).toEqual([photo()]);
    expect(result.formulas).toEqual([formula()]);
    expect(result.treatments).toEqual([treatment()]);
  });

  it("never includes appointments or the unified timeline field -- those are not part of this tab's data", () => {
    const payload = timelinePayload();
    const result = buildHistoryStateFromTimeline(payload);
    expect(result).not.toHaveProperty("appointments");
    expect(result).not.toHaveProperty("timeline");
  });
});
