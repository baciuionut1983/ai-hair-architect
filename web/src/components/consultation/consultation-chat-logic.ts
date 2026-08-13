export type ConsultationHistoryLoadStatus = "ready" | "error";

export function resolveConsultationHistoryLoadStatus(response: { ok: boolean }): ConsultationHistoryLoadStatus {
  return response.ok ? "ready" : "error";
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function isSendableMessage(value: string): boolean {
  return value.trim().length > 0;
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
