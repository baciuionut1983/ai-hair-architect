// The single source of truth for every language this platform knows
// about -- UI chrome, Consult AI conversation, STT, and TTS all read
// THIS registry rather than each maintaining their own hardcoded
// language union. Deliberately NOT a closed TypeScript union
// ("ro" | "en" | "ar" | ...): a real global product needs to be able to
// add a language by adding a DATA entry (plus, for full UI, a
// translation dictionary in translations.ts) -- never by touching a type
// declaration or hunting down switch statements scattered across
// components. `LanguageCode` is therefore a plain `string`, expected to
// be a BCP-47 primary language subtag (ISO 639-1, e.g. "en", "ro", "ar",
// "zh") that's been validated against this registry at runtime via
// isLanguageCode/parseLanguageCode -- the registry is the actual source
// of truth, not the type system.
export type LanguageCode = string;

export type TextDirection = "ltr" | "rtl";

// "full": a genuinely complete, audited UI translation (app shell +
//   every page covered by translations.ts).
// "beta": a real but partial UI translation (app shell + page titles
//   today, see translations.ts's own coverage note) -- shown in the
//   selector, honestly labeled, never claimed as complete.
// "none": no UI translation exists yet -- this language may still be
//   fully capable for Consult AI conversation/STT/TTS (those are
//   tracked independently below), or may be a placeholder entry not
//   activated for anything yet.
export type UiSupportLevel = "full" | "beta" | "none";

export interface LanguageDefinition {
  // BCP-47 primary language subtag -- the registry's own unique key.
  // Usually a bare ISO 639-1 code ("en", "ro", "ar"), but may be a
  // compound tag when a script/region distinction is the language
  // itself for this product's purposes (e.g. "zh-Hans" vs "zh-Hant" are
  // modeled as two separate entries/codes, not one "zh" entry with a
  // hidden variant).
  code: LanguageCode;
  // The fuller BCP-47 locale tag used for general locale purposes (date/
  // number formatting, the account's own stored preference) -- often
  // `code` plus a region, e.g. "en-US", "zh-Hans".
  locale: string;
  // English name, for contexts where the reader may not know the
  // language yet (e.g. an English-speaking admin's audit log).
  label: string;
  // The name written in the language's own script, for the selector UI.
  nativeName: string;
  direction: TextDirection;
  // BCP-47 tag specifically for SpeechSynthesisUtterance.lang / voice
  // matching -- usually the same as `locale`, kept separate because a
  // language's most common TTS voice region can differ from its most
  // natural general locale (no single obvious "main" country the way
  // ro-RO/en-US have one, for several languages).
  speechLocale: string;
  uiSupportLevel: UiSupportLevel;
  conversationSupported: boolean;
  sttSupported: boolean;
  ttsSupported: boolean;
}

// Generic right-to-left detection: RTL is a property of the LANGUAGE
// (its script), not something hand-set per entry and easy to forget --
// any current or future registry entry whose code is in this set is
// automatically RTL, with zero risk of a newly added RTL language (e.g.
// Hebrew, Persian, Urdu) shipping with the wrong direction because
// someone forgot to flip a flag. ISO 639-1 codes for the world's
// commonly used right-to-left scripts (Arabic, Hebrew, and other
// Arabic-/Hebrew-script languages).
const RTL_LANGUAGE_CODES = new Set([
  "ar", "he", "fa", "ur", "ps", "sd", "ku", "yi", "dv", "syr", "arc",
]);

export function isRtlLanguageCode(code: LanguageCode): boolean {
  const primary = code.split("-")[0]?.toLowerCase() ?? code.toLowerCase();
  return RTL_LANGUAGE_CODES.has(primary);
}

export function getTextDirection(code: LanguageCode): TextDirection {
  return isRtlLanguageCode(code) ? "rtl" : "ltr";
}

function define(entry: Omit<LanguageDefinition, "direction">): LanguageDefinition {
  return { ...entry, direction: getTextDirection(entry.code) };
}

// ACTIVE languages: real, end-to-end Consult AI conversation + STT + TTS
// support today (see consultation-chat-provider-gemini.ts,
// voice-transcript/route.ts, consultation-chat-tts-logic.ts -- none of
// them hardcode these specific codes; they all read this registry).
// English and Romanian additionally have a complete UI translation;
// Arabic/Italian/French/German/Spanish have a real but partial one
// (nav/shell/page-titles -- see translations.ts) and are marked "beta".
//
// PREPARED languages below: real BCP-47 metadata (including correct RTL
// direction, derived generically above, e.g. for Hebrew) so the registry
// itself demonstrates the platform is designed for global language
// support, not just the initial seven -- but conversation/STT/TTS/UI are
// all honestly `false`/"none" until each is actually wired and tested,
// never claimed prematurely. Activating one later is a data change
// (flip its flags, add a translations.ts dictionary) -- not a
// component-level refactor.
export const LANGUAGE_REGISTRY: LanguageDefinition[] = [
  define({
    code: "en", locale: "en-US", label: "English", nativeName: "English",
    speechLocale: "en-US", uiSupportLevel: "full",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "ro", locale: "ro-RO", label: "Romanian", nativeName: "Română",
    speechLocale: "ro-RO", uiSupportLevel: "full",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "ar", locale: "ar-SA", label: "Arabic", nativeName: "العربية",
    speechLocale: "ar-SA", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "it", locale: "it-IT", label: "Italian", nativeName: "Italiano",
    speechLocale: "it-IT", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "fr", locale: "fr-FR", label: "French", nativeName: "Français",
    speechLocale: "fr-FR", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "de", locale: "de-DE", label: "German", nativeName: "Deutsch",
    speechLocale: "de-DE", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "es", locale: "es-ES", label: "Spanish", nativeName: "Español",
    speechLocale: "es-ES", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  // -- Prepared, not yet activated (see comment above) --
  define({
    code: "pt", locale: "pt-PT", label: "Portuguese", nativeName: "Português",
    speechLocale: "pt-PT", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "nl", locale: "nl-NL", label: "Dutch", nativeName: "Nederlands",
    speechLocale: "nl-NL", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "pl", locale: "pl-PL", label: "Polish", nativeName: "Polski",
    speechLocale: "pl-PL", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "tr", locale: "tr-TR", label: "Turkish", nativeName: "Türkçe",
    speechLocale: "tr-TR", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "el", locale: "el-GR", label: "Greek", nativeName: "Ελληνικά",
    speechLocale: "el-GR", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "he", locale: "he-IL", label: "Hebrew", nativeName: "עברית",
    speechLocale: "he-IL", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "ja", locale: "ja-JP", label: "Japanese", nativeName: "日本語",
    speechLocale: "ja-JP", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "ko", locale: "ko-KR", label: "Korean", nativeName: "한국어",
    speechLocale: "ko-KR", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "zh-Hans", locale: "zh-Hans-CN", label: "Chinese (Simplified)", nativeName: "简体中文",
    speechLocale: "zh-CN", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "zh-Hant", locale: "zh-Hant-TW", label: "Chinese (Traditional)", nativeName: "繁體中文",
    speechLocale: "zh-TW", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
  define({
    code: "hi", locale: "hi-IN", label: "Hindi", nativeName: "हिन्दी",
    speechLocale: "hi-IN", uiSupportLevel: "none",
    conversationSupported: false, sttSupported: false, ttsSupported: false,
  }),
];

const REGISTRY_BY_CODE: Map<LanguageCode, LanguageDefinition> = new Map(
  LANGUAGE_REGISTRY.map((entry) => [entry.code, entry]),
);

export const LANGUAGE_CODES: LanguageCode[] = LANGUAGE_REGISTRY.map((entry) => entry.code);

export function isLanguageCode(value: string): boolean {
  return REGISTRY_BY_CODE.has(value);
}

// Narrower than isLanguageCode: true only for a registry entry that's
// actually wired for Consult AI conversation (AI reply/STT/TTS) today,
// not merely a "prepared" placeholder entry. The one validation every
// language-hint boundary (the chat route's request body, the STT hint,
// the Consult AI selector) should use, so "is this code usable for a
// conversation" is answered in exactly one place.
export function isConversationLanguageCode(value: string): boolean {
  return REGISTRY_BY_CODE.get(value)?.conversationSupported === true;
}

export function getLanguageDefinition(code: LanguageCode): LanguageDefinition | undefined {
  return REGISTRY_BY_CODE.get(code);
}

// Same as getLanguageDefinition, but for call sites that already know
// (by construction, e.g. iterating LANGUAGE_CODES) that the code is
// real -- avoids `| undefined` noise at those sites without silently
// swallowing an actually-invalid code elsewhere.
export function requireLanguageDefinition(code: LanguageCode): LanguageDefinition {
  const entry = REGISTRY_BY_CODE.get(code);
  if (!entry) {
    throw new Error(`Unknown language code: ${code}`);
  }
  return entry;
}

// Parses an arbitrary, possibly-untrusted string (a stored User.locale
// value, a request body field, a browser's navigator.language) into a
// real, registry-known LanguageCode, falling back to a safe default --
// never throws, never silently narrows an already-valid non-en/ro code
// back to "en" (the exact bug this replaces: earlier toLocale()-style
// helpers hardcoded `value === "ro" ? "ro" : "en"`, which would have
// quietly corrupted e.g. a stored "ar" back to "en" on every read).
export function parseLanguageCode(value: string | null | undefined, fallback: LanguageCode = "en"): LanguageCode {
  if (!value) return fallback;
  return isLanguageCode(value) ? value : fallback;
}

// Best-effort mapping from a BCP-47-ish browser/Accept-Language tag
// (e.g. "ro", "ro-RO", "fr-CA", "zh-Hans-CN") to the closest registry
// language, by matching the primary subtag (and, for compound registry
// codes like "zh-Hans", the first two subtags). Used for the ONE-TIME
// initial guess at registration -- never re-applied afterward, since the
// stored User.locale (or an explicit selector choice) always wins once
// it exists.
export function resolveLanguageCodeFromBrowserTag(tag: string | null | undefined, fallback: LanguageCode = "en"): LanguageCode {
  if (!tag) return fallback;
  const subtags = tag.trim().split(/[-_]/);
  const primary = subtags[0]?.toLowerCase() ?? "";
  const compoundLower = subtags.length > 1 ? `${primary}-${subtags[1].toLowerCase()}` : primary;

  // Compound registry codes (e.g. "zh-Hans") use their canonical BCP-47
  // casing, but browsers don't always send it back that way -- matched
  // case-insensitively here, then resolved to the registry's own casing.
  const compoundMatch = LANGUAGE_CODES.find((code) => code.toLowerCase() === compoundLower);
  if (compoundMatch) return compoundMatch;
  if (isLanguageCode(primary)) return primary;
  return fallback;
}

export function uiSupportedLanguages(): LanguageDefinition[] {
  return LANGUAGE_REGISTRY.filter((entry) => entry.uiSupportLevel !== "none");
}

export function conversationSupportedLanguages(): LanguageDefinition[] {
  return LANGUAGE_REGISTRY.filter((entry) => entry.conversationSupported);
}
