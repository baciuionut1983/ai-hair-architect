import { describe, expect, it } from "vitest";

import {
  buildChatLanguageFields,
  describeSendFailure,
  extractMemoryDecisionIds,
  isSendableMessage,
  languageSelectionToSpeechLocale,
  parseStoredLanguageSelection,
  resolveConsultationHistoryLoadStatus,
  resolveSttLanguageHint,
  speechLocaleToLanguageSelection
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

// Regression: reopening Consult AI (or reloading the page) showed active
// Confirm/Edit/Reject buttons again on proposedMemory cards the stylist had
// already decided on -- the confirmed/rejected sets lived only in React
// state, reset to empty on every mount. These lock in that the real,
// persisted decision (proposedMemoryDecision on each message, from the
// database) is what seeds those sets after every reload.
describe("extractMemoryDecisionIds", () => {
  it("puts a confirmed message's id in the confirmed set only", () => {
    const { confirmed, rejected } = extractMemoryDecisionIds([
      { id: "msg-1", proposedMemoryDecision: "confirmed" },
    ]);
    expect(confirmed.has("msg-1")).toBe(true);
    expect(rejected.has("msg-1")).toBe(false);
  });

  it("puts a rejected message's id in the rejected set only", () => {
    const { confirmed, rejected } = extractMemoryDecisionIds([
      { id: "msg-1", proposedMemoryDecision: "rejected" },
    ]);
    expect(rejected.has("msg-1")).toBe(true);
    expect(confirmed.has("msg-1")).toBe(false);
  });

  it("puts a pending (no decision) message's id in neither set -- it may still show active buttons", () => {
    const { confirmed, rejected } = extractMemoryDecisionIds([{ id: "msg-1" }]);
    expect(confirmed.has("msg-1")).toBe(false);
    expect(rejected.has("msg-1")).toBe(false);
  });

  it("correctly separates a full mixed conversation history in one pass", () => {
    const { confirmed, rejected } = extractMemoryDecisionIds([
      { id: "confirmed-1", proposedMemoryDecision: "confirmed" },
      { id: "rejected-1", proposedMemoryDecision: "rejected" },
      { id: "pending-1" },
      { id: "confirmed-2", proposedMemoryDecision: "confirmed" },
      { id: "no-proposal-1" },
    ]);

    expect([...confirmed]).toEqual(["confirmed-1", "confirmed-2"]);
    expect([...rejected]).toEqual(["rejected-1"]);
  });

  it("returns empty sets for an empty history", () => {
    const { confirmed, rejected } = extractMemoryDecisionIds([]);
    expect(confirmed.size).toBe(0);
    expect(rejected.size).toBe(0);
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

describe("parseStoredLanguageSelection", () => {
  it("accepts the two concrete stored values", () => {
    expect(parseStoredLanguageSelection("en")).toBe("en");
    expect(parseStoredLanguageSelection("ro")).toBe("ro");
  });

  it("defaults to auto for null, garbage, or an explicit 'auto' value", () => {
    expect(parseStoredLanguageSelection(null)).toBe("auto");
    expect(parseStoredLanguageSelection("fr")).toBe("auto");
    expect(parseStoredLanguageSelection("auto")).toBe("auto");
    expect(parseStoredLanguageSelection("")).toBe("auto");
  });
});

describe("languageSelectionToSpeechLocale / speechLocaleToLanguageSelection", () => {
  it("round-trips both directions", () => {
    expect(languageSelectionToSpeechLocale("ro")).toBe("ro-RO");
    expect(languageSelectionToSpeechLocale("en")).toBe("en-US");
    expect(speechLocaleToLanguageSelection("ro-RO")).toBe("ro");
    expect(speechLocaleToLanguageSelection("en-US")).toBe("en");
  });
});

describe("buildChatLanguageFields", () => {
  it("sends languagePreference as a forced override for a concrete selection, regardless of conversation locale", () => {
    expect(buildChatLanguageFields("ro", "en-US")).toEqual({ languagePreference: "ro" });
    expect(buildChatLanguageFields("ro", null)).toEqual({ languagePreference: "ro" });
  });

  it("sends conversationLanguage as a fallback only when auto and a conversation locale is already established", () => {
    expect(buildChatLanguageFields("auto", "ro-RO")).toEqual({ conversationLanguage: "ro" });
  });

  it("sends neither field when auto and no conversation locale has been established yet", () => {
    expect(buildChatLanguageFields("auto", null)).toEqual({});
  });
});

describe("resolveSttLanguageHint", () => {
  it("a concrete selection always wins", () => {
    expect(resolveSttLanguageHint("ro", "en-US")).toBe("ro");
    expect(resolveSttLanguageHint("en", null)).toBe("en");
  });

  it("auto falls back to the established conversation locale", () => {
    expect(resolveSttLanguageHint("auto", "ro-RO")).toBe("ro");
  });

  it("auto with no established conversation locale yet returns undefined (no hint sent)", () => {
    expect(resolveSttLanguageHint("auto", null)).toBeUndefined();
  });
});
