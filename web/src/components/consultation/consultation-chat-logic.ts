import { isConversationLanguageCode, type LanguageCode } from "@/lib/language-registry";

export type ConsultationHistoryLoadStatus = "ready" | "error";

// The Consult AI "Language" selector's own state: "auto" follows the
// conversation (per-message detection, see consultation-chat-tts-logic.ts's
// resolveReplyLanguage); a concrete LanguageCode explicitly fixes it --
// the SAME currency used for the STT hint, the AI-reply-language hint,
// and (via languageToSpeechLocale) the TTS voice, so there is exactly one
// language identity per turn, never three independently-tracked ones.
export type LanguageSelection = "auto" | LanguageCode;

// localStorage key for the selector -- a per-browser preference so the
// stylist never has to reselect on every page/session (persists
// immediately and locally; a concrete, non-"auto" choice is additionally
// best-effort synced to the account via POST /api/v1/account/locale, for
// cross-device persistence).
export const LANGUAGE_SELECTION_STORAGE_KEY = "aha:consult-ai:language-selection";

export function parseStoredLanguageSelection(value: string | null): LanguageSelection {
  return value && isConversationLanguageCode(value) ? value : "auto";
}

export interface ChatLanguageFields {
  languagePreference?: LanguageCode;
  conversationLanguage?: LanguageCode;
}

// Computes exactly the two optional language fields a chat POST body sends,
// mirroring the same forced-vs-fallback split the backend enforces (see
// ConsultationChatLanguageHint in consultation-chat-service.ts): a concrete
// selector value is always a hard override (languagePreference); "auto"
// sends only the conversation's own currently-tracked language, if any, as
// a soft, ambiguous-message-only fallback -- never a forced one.
export function buildChatLanguageFields(selection: LanguageSelection, conversationLanguage: LanguageCode | null): ChatLanguageFields {
  if (selection !== "auto") {
    return { languagePreference: selection };
  }
  if (conversationLanguage) {
    return { conversationLanguage };
  }
  return {};
}

// Resolves the STT language hint sent with a voice recording (see
// finishRecording's trailing optional param): a concrete selector value
// always wins; "auto" falls back to the conversation's own currently
// tracked language, if any is established yet.
export function resolveSttLanguageHint(selection: LanguageSelection, conversationLanguage: LanguageCode | null): LanguageCode | undefined {
  if (selection !== "auto") {
    return selection;
  }
  return conversationLanguage ?? undefined;
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

// Audit finding (Speak to AI end-to-end trace): the ONLY thing preventing
// a stylist from starting a second, overlapping voice recording while the
// first one's transcript is still being generated (chatProcessing, ~8s in
// production) or its resulting message is still being sent to the AI
// (sending, ~15s in production) was the Mic button's `loading` prop
// implicitly disabling it via Button's own `disabled={disabled || loading}`
// -- correct today, but an easy-to-lose invariant buried inside a UI
// component rather than an explicit, independently-testable contract. A
// second overlapping recording during that ~23s window would let two
// finishRecording calls race, each unconditionally toggling shared
// recording/processing state -- not itself catastrophic (sendMessage's own
// `sending` guard still stops a duplicate SEND), but confusing UI state and
// a real risk if either guard is ever refactored independently.  Naming
// and testing this explicitly turns "happens to work because of how two
// separate props interact" into a real, provable guarantee.
export function isVoiceInputBusy(sending: boolean, chatProcessing: boolean): boolean {
  return sending || chatProcessing;
}

// Audit finding (cloud Voice Reply playback trace): a live retest showed
// TWO different fallback messages after a successful cloud TTS response
// ("Voice reply failed..." then "cloud voice service unavailable...
// reading with browser's default voice instead") -- traced to the local
// Web Speech fallback being triggered TWICE for a single cloud playback
// failure, because the <audio> element's own `error` event and its
// play() promise rejection are both legitimate, independent signals for
// the very same underlying failure in most browsers. The second
// fallback call's synth.cancel() interrupted the first call's
// already-queued utterance, which then fired its own onerror as
// "canceled" -- two real, but misleading, error messages from one root
// cause. This is a small, generic, reusable guarantee (not specific to
// audio, or to any one language) that a given side effect runs AT MOST
// ONCE, no matter how many of its possible triggers actually fire.
export function callOnce(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
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

export interface ProposedDirectionPresentation {
  status: "pending" | "applied";
  showApplyButton: boolean;
  showNoAnalysisGuidance: boolean;
}

// Decides what the "AI Proposed Direction" card shows, purely from state --
// kept separate from the JSX (ChatBubble in consultation-chat.tsx) so the
// exact branching is independently testable without a rendering
// environment. This is where the card's own honesty requirement lives:
// "impossible to confuse a proposal with an already-saved change".
// `applied` must only ever be true after a real, successful
// POST /api/v1/analysis/{id}/correct (see handleApplyCorrection) -- never
// assumed from anything else, so this function never has to guess.
export function resolveProposedDirectionPresentation(input: {
  hasAnalysisId: boolean;
  applied: boolean;
}): ProposedDirectionPresentation {
  return {
    status: input.applied ? "applied" : "pending",
    showApplyButton: input.hasAnalysisId && !input.applied,
    // A general conversation (no analysisId) has no Analysis row to apply
    // to yet -- Phase 2 territory (AnalysisProposal persistence). Shown
    // whenever there's no analysisId to target, regardless of `applied`,
    // which in practice can only ever be true when hasAnalysisId is too.
    showNoAnalysisGuidance: !input.hasAnalysisId,
  };
}

export type NoAnalysisGuidanceActionMode = "switchTab" | "navigateToClientPage";

// Regression this exists to prevent: the no-analysis guidance CTA
// (ProposedDirectionCard) once linked to /clients/{clientId} unconditionally
// -- but the ONLY place that guidance ever renders (the general Consult AI
// tab) is already rendered AT that exact URL, since that page's tabs are
// local React state, not routed. A same-route Link is a no-op Next.js
// doesn't remount, so the CTA silently did nothing on click. "switchTab"
// (a real callback the parent page uses to change its own local tab
// state) must always be preferred whenever the caller provides one;
// "navigateToClientPage" (the plain cross-page Link) is only a fallback
// for a caller with no such tab concept. Kept as its own pure decision so
// a future refactor that accidentally stops wiring the callback -- or
// reverts to always using the Link -- fails a test instead of silently
// reintroducing a dead control.
export function resolveNoAnalysisGuidanceActionMode(hasNavigateCallback: boolean): NoAnalysisGuidanceActionMode {
  return hasNavigateCallback ? "switchTab" : "navigateToClientPage";
}
