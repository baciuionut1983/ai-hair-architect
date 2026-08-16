import { languageToSpeechLocale, speechLocaleToLanguage, type SpeechLocale } from "./consultation-chat-tts-logic";

export type ConsultationHistoryLoadStatus = "ready" | "error";

// The Consult AI "Language" selector's own state: "auto" follows the
// conversation (per-message detection, see consultation-chat-tts-logic.ts's
// resolveReplySpeechLocale); a concrete value explicitly fixes it. Distinct
// from SpeechLocale ("ro-RO"/"en-US", a BCP-47 tag needed for
// SpeechSynthesisUtterance.lang) -- this uses contracts.ts's own Locale
// vocabulary ("en"/"ro") since it is also what's sent to the backend
// (forcedReplyLanguage/fallbackReplyLanguage) and persisted to the
// account's User.locale.
export type LanguageSelection = "auto" | "en" | "ro";

// localStorage key for the selector -- a per-browser preference so the
// stylist never has to reselect on every page/session (persists
// immediately and locally; a concrete, non-"auto" choice is additionally
// best-effort synced to the account via POST /api/v1/account/locale, for
// cross-device persistence).
export const LANGUAGE_SELECTION_STORAGE_KEY = "aha:consult-ai:language-selection";

export function parseStoredLanguageSelection(value: string | null): LanguageSelection {
  return value === "en" || value === "ro" ? value : "auto";
}

// Both delegate to the app's single canonical "en"/"ro" <-> SpeechLocale
// mapping (consultation-chat-tts-logic.ts) rather than maintaining a
// second copy -- kept as named exports here since callers throughout this
// file/consultation-chat.tsx already refer to the "LanguageSelection"
// framing of this mapping.
export const languageSelectionToSpeechLocale = languageToSpeechLocale;
export const speechLocaleToLanguageSelection = speechLocaleToLanguage;

export interface ChatLanguageFields {
  languagePreference?: "en" | "ro";
  conversationLanguage?: "en" | "ro";
}

// Computes exactly the two optional language fields a chat POST body sends,
// mirroring the same forced-vs-fallback split the backend enforces (see
// ConsultationChatLanguageHint in consultation-chat-service.ts): a concrete
// selector value is always a hard override (languagePreference); "auto"
// sends only the conversation's own currently-tracked language, if any, as
// a soft, ambiguous-message-only fallback -- never a forced one.
export function buildChatLanguageFields(selection: LanguageSelection, conversationLocale: SpeechLocale | null): ChatLanguageFields {
  if (selection !== "auto") {
    return { languagePreference: selection };
  }
  if (conversationLocale) {
    return { conversationLanguage: speechLocaleToLanguageSelection(conversationLocale) };
  }
  return {};
}

// Resolves the STT language hint sent with a voice recording (see
// finishRecording's trailing optional param): a concrete selector value
// always wins; "auto" falls back to the conversation's own currently
// tracked language, if any is established yet.
export function resolveSttLanguageHint(selection: LanguageSelection, conversationLocale: SpeechLocale | null): "en" | "ro" | undefined {
  if (selection !== "auto") {
    return selection;
  }
  return conversationLocale ? speechLocaleToLanguageSelection(conversationLocale) : undefined;
}

export function resolveConsultationHistoryLoadStatus(response: { ok: boolean }): ConsultationHistoryLoadStatus {
  return response.ok ? "ready" : "error";
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function isSendableMessage(value: string): boolean {
  return value.trim().length > 0;
}

// Regression: reopening Consult AI (or reloading the page) showed active
// Confirm/Edit/Reject buttons again on proposedMemory cards the stylist had
// already decided on -- the decision lived only in transient React state,
// reset to empty on every mount. This derives the real, persisted decision
// sets directly from the loaded history (each message's own
// proposedMemoryDecision, written by the backend on Confirm/Reject), so a
// decision made in an earlier session is never forgotten or re-offered.
export function extractMemoryDecisionIds(
  messages: { id: string; proposedMemoryDecision?: "confirmed" | "rejected" }[],
): { confirmed: Set<string>; rejected: Set<string> } {
  const confirmed = new Set<string>();
  const rejected = new Set<string>();
  for (const message of messages) {
    if (message.proposedMemoryDecision === "confirmed") {
      confirmed.add(message.id);
    } else if (message.proposedMemoryDecision === "rejected") {
      rejected.add(message.id);
    }
  }
  return { confirmed, rejected };
}

// Maps a failed send's HTTP status to a short, honest explanation -- never
// implies the AI understood and silently failed; always states plainly what
// happened so the stylist knows whether to retry, wait, or that nothing was
// sent at all beyond their own message (which the backend always persists
// first, before calling the provider).
export function describeSendFailure(status: number): string {
  switch (status) {
    case 404:
      return "This analysis could not be found.";
    case 429:
      return "Too many messages sent in a short time. Please wait a moment and try again.";
    case 503:
      return "The AI consultation assistant is not available right now.";
    case 504:
      return "The AI assistant took too long to respond. Please try again.";
    case 502:
      return "The AI assistant returned an unexpected response. Please try again.";
    default:
      return "Something went wrong sending your message. Please try again.";
  }
}
