import { describe, expect, it } from "vitest";

import {
  createAppointment,
  createClient,
  createClientPhoto,
  createFormulaRecord,
  createTreatmentRecord,
  createUser,
  getClientTimelineByUser,
  store
} from "./milestone1-store";

describe("milestone3 timeline", () => {
  it("includes photos, formulas, treatments, consultations and appointments", () => {
    const user = createUser({
      email: `timeline-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const client = createClient({
      ownerUserId: user.id,
      fullName: "Timeline Client"
    });

    createClientPhoto({
      clientId: client.id,
      imageUrl: "https://example.com/photo-1.jpg",
      caption: "before"
    });

    createFormulaRecord({
      clientId: client.id,
      formulaName: "Gloss 7N",
      formulaDetails: "7N + 10 vol"
    });

    createTreatmentRecord({
      clientId: client.id,
      treatmentName: "Hydration mask",
      treatmentDetails: "15 minute protocol"
    });

    const consultationCreatedAt = new Date(Date.now() + 2000).toISOString();
    store.consultations.push({
      id: `consult-${Date.now()}`,
      clientId: client.id,
      analysisId: "analysis-1",
      summary: "Consultation summary",
      nextSteps: ["Step 1"],
      createdAt: consultationCreatedAt
    });

    createAppointment({
      ownerUserId: user.id,
      clientId: client.id,
      title: "Recheck",
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      reminderMinutesBefore: 60,
      reminderType: "appointment",
      notes: "Bring updated photos"
    });

    const timeline = getClientTimelineByUser(client.id, user.id);
    const kinds = new Set(timeline.map((entry) => entry.kind));

    expect(kinds.has("photo")).toBe(true);
    expect(kinds.has("formula")).toBe(true);
    expect(kinds.has("treatment")).toBe(true);
    expect(kinds.has("consultation")).toBe(true);
    expect(kinds.has("appointment")).toBe(true);

    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index - 1].createdAt >= timeline[index].createdAt).toBe(true);
    }
  });
});
