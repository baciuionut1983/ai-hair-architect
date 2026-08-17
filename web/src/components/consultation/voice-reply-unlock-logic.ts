// iOS Safari (and other WebKit-based mobile browsers) require
// HTMLMediaElement.play() to be invoked synchronously within a genuine user
// gesture's call stack the first time a page plays audio -- once that
// succeeds, the element (and, per WebKit's own documented autoplay
// behavior, the page more broadly) is "unlocked" for the rest of the
// session, and later programmatic play() calls -- even from async
// contexts, e.g. after awaiting a network response -- are then allowed.
//
// Toggling "Voice Reply: On" is the one deliberate, synchronous user
// gesture this feature has. A real AI reply's own audio.play() call, by
// contrast, is only ever reached after at least two real network
// round-trips (the chat completion, then cloud TTS synthesis) -- by which
// point iOS Safari's transient user-activation window has already
// expired. This is the root cause of Voice Reply working on desktop
// (where autoplay policy is considerably more lenient about programmatic
// playback outside a strict gesture chain) while silently producing no
// audio at all on iPhone, with no error surfaced, because play()/speak()
// is simply never granted permission to start.
//
// The fix: spend the toggle-on click's own gesture immediately, playing a
// real (if silent) clip on the SAME persistent <audio> element that will
// later be reused for every actual cloud TTS reply -- reusing one element,
// rather than constructing a fresh `new Audio()` per reply, is the most
// broadly WebKit-compatible form of this pattern (some iOS versions have
// scoped the unlock to the specific element that played, not just the
// page). If that attempt is rejected, Voice Reply must not claim to be on
// -- see resolveVoiceReplyEnableOutcome below.

// A ~25ms, 8kHz mono 16-bit PCM WAV of true silence -- the smallest audio
// this app's own WAV format (see tts-audio-format.ts) can express as a
// real, playable clip. Long enough that browsers don't treat it as a
// degenerate zero-length resource; silent so nothing audible happens on
// every toggle-on click. Zero network dependency, so playback can start
// synchronously within the click handler, before anything could cost the
// gesture its validity.
export const AUDIO_UNLOCK_DATA_URI =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Regression, confirmed against this app's own CSP header (next.config.ts):
// media-src is 'self' blob: -- deliberately, added once already for cloud
// Voice Reply's own <audio> playback (see that header's own comment) --
// and does NOT include the data: scheme. A first version of this unlock
// mechanism set audio.src directly to AUDIO_UNLOCK_DATA_URI (a data: URI)
// -- CSP blocks that at the browser's security-policy level before ever
// attempting to decode it, deterministically, on every CSP-enforcing
// browser regardless of platform or gesture timing, surfacing as exactly
// the failure next.config.ts's own comment already documents for the
// same mistake once before: "MEDIA_ELEMENT_ERROR: Media rejected by URL
// safety check" + play() rejecting with NotSupportedError. Converting to
// a blob: URL (already permitted) fixes it without touching CSP at all --
// this app's own cloud TTS playback already proves that scheme works.
export function dataUriToBlob(dataUri: string): Blob {
  const commaIndex = dataUri.indexOf(",");
  const header = dataUri.slice(0, commaIndex);
  const base64 = dataUri.slice(commaIndex + 1);
  const mimeMatch = /^data:([^;]+);base64$/.exec(header);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

export interface VoiceReplyEnableOutcome {
  enabled: boolean;
  message: string | null;
}

export const VOICE_REPLY_UNLOCK_FAILED_MESSAGE =
  "Voice reply couldn't be enabled on this device. Please tap the button again.";

// The toggle must never claim "Voice Reply: On" if the gesture-synchronous
// unlock attempt it just made failed -- a stylist would otherwise believe
// audio is coming and never learn why it never plays (see this file's own
// module comment). A rejected unlock leaves the toggle off, with an honest,
// actionable message -- the conversation itself is never blocked, and the
// text reply is unaffected either way.
export function resolveVoiceReplyEnableOutcome(unlockSucceeded: boolean): VoiceReplyEnableOutcome {
  return unlockSucceeded
    ? { enabled: true, message: null }
    : { enabled: false, message: VOICE_REPLY_UNLOCK_FAILED_MESSAGE };
}
