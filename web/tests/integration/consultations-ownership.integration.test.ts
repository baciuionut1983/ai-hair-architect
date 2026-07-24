import { beforeEach, describe, expect, it } from "vitest";

import { createClient, createUser, getConsultationByIdForUser, store } from "@/lib/milestone1-store";

describe("consultation ownership integration", () => {
  beforeEach(() => {
    store.users = [];
    store.clients = [];
    store.consultations = [];
  });

  it("returns consultation only to the owning user's client scope", () => {
    const owner = createUser({ email: "owner@example.com", password: "pass123", role: "professional", locale: "en" });
    const other = createUser({ email: "other@example.com", password: "pass123", role: "professional", locale: "en" });
    const ownerClient = createClient({ ownerUserId: owner.id, fullName: "Owner Client" });

    const consultation = {
      id: "consultation-owned",
      clientId: ownerClient.id,
      analysisId: "analysis-owned",
      summary: "Owner summary",
      nextSteps: ["step"],
      createdAt: new Date().toISOString(),
    };
    store.consultations.push(consultation);

    const ownerResult = getConsultationByIdForUser(consultation.id, owner.id);
    const otherResult = getConsultationByIdForUser(consultation.id, other.id);

    expect(ownerResult).toMatchObject({ id: "consultation-owned" });
    expect(otherResult).toBeNull();
  });
});