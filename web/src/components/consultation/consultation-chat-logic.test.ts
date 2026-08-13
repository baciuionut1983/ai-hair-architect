import { describe, expect, it } from "vitest";

import {
  describeSendFailure,
  isSendableMessage,
  resolveConsultationHistoryLoadStatus
} from "./consultation-chat-logic";

describe("resolveConsultationHistoryLoadStatus", () => {
  it("is ready for an ok response", () => {
    expect(resolveConsultationHistoryLoadStatus({ ok: true })).toBe("ready");
  });

  it("is error for a non-ok response", () => {
    expect(resolveConsultationHistoryLoadStatus({ ok: false })).toBe("error");
  });
});

describe("isSendableMessage", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(isSendableMessage("")).toBe(false);
    expect(isSendableMessage("   ")).toBe(false);
  });

  it("accepts real text, ignoring surrounding whitespace", () => {
    expect(isSendableMessage("  Her density is low  ")).toBe(true);
  });
});

describe("describeSendFailure", () => {
  it("maps documented statuses to distinct, honest explanations", () => {
    const statuses = [404, 429, 503, 504, 502, 500];
    const messages = statuses.map(describeSendFailure);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("never claims the message was understood or answered on failure", () => {
    for (const status of [404, 429, 503, 504, 502, 500]) {
      expect(describeSendFailure(status).toLowerCase()).not.toContain("noted");
    }
  });
});
