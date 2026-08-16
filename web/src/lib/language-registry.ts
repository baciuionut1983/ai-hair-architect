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
//
// This is NOT closed at ~18 entries either. Four capability dimensions
// are tracked INDEPENDENTLY per language, and are expected to evolve
// independently as this product's providers' real capabilities do:
//   - uiSupportLevel: does the app SHELL/menus have real translated text?
//   - conversationSupported: can Gemini actually converse in this
//     language? (see the audit note below the registry -- based on
//     Gemini's own documented supported-language list, not a guess.)
//   - sttSupported: can this app's voice-transcript route (which calls
//     the SAME Gemini generateContent endpoint, just with inline audio
//     instead of only text) transcribe this language?
//   - ttsSupported: is there a real BCP-47 speechLocale this app can ask
//     the BROWSER's Web Speech API to attempt? This is an ARCHITECTURE
//     claim only -- it does NOT mean a voice is actually installed on any
//     given device. Runtime voice availability is a separate, per-device
//     fact determined by speechSynthesis.getVoices() at the moment of
//     speaking (see consultation-chat-tts-logic.ts's selectVoiceForLocale
//     / speakReply's onVoiceUnavailable) -- never claimed here.
// A language can be conversationSupported=true with uiSupportLevel="none"
// (Consult AI can fully talk to a stylist in Turkish today even though
// the app's own menus aren't translated into Turkish yet) -- these are
// genuinely independent, exactly as required.
export type LanguageCode = string;

export type TextDirection = "ltr" | "rtl";

// "full": a genuinely complete, audited UI translation (app shell +
//   every page covered by translations.ts).
// "beta": a real but partial UI translation (app shell + Consult AI's own
//   chrome today -- see translations.ts's own coverage note) -- shown in
//   the selector, honestly labeled, never claimed as complete.
// "none": no UI translation exists yet -- this language may still be
//   fully capable for Consult AI conversation/STT/TTS (tracked
//   independently below), or may be a placeholder entry not activated
//   for anything at all yet.
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
  // `code` plus a region, e.g. "en-US", "zh-Hans-CN". Kept distinct from
  // `code` on purpose: a future regional variant (en-GB, pt-BR, es-MX,
  // fr-CA -- see the note at the bottom of this file) is a NEW registry
  // entry with its own `code`, never a hidden field on an existing one,
  // so persistence/UI never has to guess which region a bare "en" meant.
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
  // Architecture-level only -- see the type-level doc comment above.
  ttsSupported: boolean;
}

// Generic right-to-left detection: RTL is a property of the LANGUAGE
// (its script), not something hand-set per entry and easy to forget --
// any current or future registry entry whose code is in this set is
// automatically RTL, with zero risk of a newly added RTL language
// shipping with the wrong direction because someone forgot to flip a
// flag. ISO 639-1 codes for the world's commonly used right-to-left
// scripts (Arabic, Hebrew, and other Arabic-/Hebrew-script languages).
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

// PROVIDER CAPABILITY AUDIT (conversationSupported/sttSupported below):
// this app's only AI conversation provider is Gemini
// (consultation-chat-provider-gemini.ts), and its only speech-to-text
// provider is the SAME Gemini generateContent endpoint called with
// inline audio (voice-transcript/route.ts) -- there is no separate STT
// service with its own, narrower language list. conversationSupported/
// sttSupported below are therefore set TOGETHER, from Gemini's own
// documented supported-language list (the languages Google's Gemini API
// documentation lists as supported for generation) -- not a guess, and
// not "every language in the world." A language NOT in that documented
// list is marked false here even if the model might produce something
// for it -- this app does not claim capability it cannot stand behind.
// ttsSupported is true for every entry with a real speechLocale (the Web
// Speech API itself has no fixed "supported languages" list -- any
// BCP-47 tag can be requested; see the type-level comment above for why
// this is an architecture claim, not a runtime guarantee).
//
// uiSupportLevel: "full" only for en/ro (complete app-wide translation);
// "beta" for every other language with a real translations.ts dictionary
// (app shell + Consult AI's own chrome today -- NOT full page-by-page
// coverage yet, see translations.ts); "none" for every language that is
// conversation/STT/TTS-capable but has no UI dictionary at all yet.
export const LANGUAGE_REGISTRY: LanguageDefinition[] = [
  // -- Full UI + full conversation/STT/TTS --
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
  // -- Beta UI (shell + Consult AI chrome) + full conversation/STT/TTS --
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
  define({
    code: "pt", locale: "pt-PT", label: "Portuguese", nativeName: "Português",
    speechLocale: "pt-PT", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "nl", locale: "nl-NL", label: "Dutch", nativeName: "Nederlands",
    speechLocale: "nl-NL", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "pl", locale: "pl-PL", label: "Polish", nativeName: "Polski",
    speechLocale: "pl-PL", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "tr", locale: "tr-TR", label: "Turkish", nativeName: "Türkçe",
    speechLocale: "tr-TR", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "el", locale: "el-GR", label: "Greek", nativeName: "Ελληνικά",
    speechLocale: "el-GR", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "he", locale: "he-IL", label: "Hebrew", nativeName: "עברית",
    speechLocale: "he-IL", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "ja", locale: "ja-JP", label: "Japanese", nativeName: "日本語",
    speechLocale: "ja-JP", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "ko", locale: "ko-KR", label: "Korean", nativeName: "한국어",
    speechLocale: "ko-KR", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "zh-Hans", locale: "zh-Hans-CN", label: "Chinese (Simplified)", nativeName: "简体中文",
    speechLocale: "zh-CN", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "zh-Hant", locale: "zh-Hant-TW", label: "Chinese (Traditional)", nativeName: "繁體中文",
    speechLocale: "zh-TW", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),
  define({
    code: "hi", locale: "hi-IN", label: "Hindi", nativeName: "हिन्दी",
    speechLocale: "hi-IN", uiSupportLevel: "beta",
    conversationSupported: true, sttSupported: true, ttsSupported: true,
  }),

  // -- No UI dictionary yet, but real conversation/STT/TTS (Gemini
  // documents supporting these) -- Consult AI can fully talk to a
  // stylist in any of these today; only the app's own menus aren't
  // translated. Activating UI for one of these is a translations.ts
  // change only. --

  // Slavic
  define({ code: "ru", locale: "ru-RU", label: "Russian", nativeName: "Русский", speechLocale: "ru-RU", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "uk", locale: "uk-UA", label: "Ukrainian", nativeName: "Українська", speechLocale: "uk-UA", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "cs", locale: "cs-CZ", label: "Czech", nativeName: "Čeština", speechLocale: "cs-CZ", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "sk", locale: "sk-SK", label: "Slovak", nativeName: "Slovenčina", speechLocale: "sk-SK", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "bg", locale: "bg-BG", label: "Bulgarian", nativeName: "Български", speechLocale: "bg-BG", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "sr", locale: "sr-RS", label: "Serbian", nativeName: "Српски", speechLocale: "sr-RS", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "hr", locale: "hr-HR", label: "Croatian", nativeName: "Hrvatski", speechLocale: "hr-HR", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "sl", locale: "sl-SI", label: "Slovenian", nativeName: "Slovenščina", speechLocale: "sl-SI", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),

  // Baltic
  define({ code: "lv", locale: "lv-LV", label: "Latvian", nativeName: "Latviešu", speechLocale: "lv-LV", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "lt", locale: "lt-LT", label: "Lithuanian", nativeName: "Lietuvių", speechLocale: "lt-LT", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),

  // Nordic
  define({ code: "sv", locale: "sv-SE", label: "Swedish", nativeName: "Svenska", speechLocale: "sv-SE", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "nb", locale: "nb-NO", label: "Norwegian", nativeName: "Norsk bokmål", speechLocale: "nb-NO", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "da", locale: "da-DK", label: "Danish", nativeName: "Dansk", speechLocale: "da-DK", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "fi", locale: "fi-FI", label: "Finnish", nativeName: "Suomi", speechLocale: "fi-FI", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),

  // Other European
  define({ code: "hu", locale: "hu-HU", label: "Hungarian", nativeName: "Magyar", speechLocale: "hu-HU", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),

  // Arabic-script family beyond Arabic itself
  define({ code: "ur", locale: "ur-PK", label: "Urdu", nativeName: "اردو", speechLocale: "ur-PK", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  // Persian: NOT on Gemini's documented supported-language list at the
  // time of this audit -- registry-only (metadata correct, RTL correct)
  // until that changes; never claimed as conversation/STT-capable
  // without real provider confirmation.
  define({ code: "fa", locale: "fa-IR", label: "Persian", nativeName: "فارسی", speechLocale: "fa-IR", uiSupportLevel: "none", conversationSupported: false, sttSupported: false, ttsSupported: true }),

  // South Asian
  define({ code: "bn", locale: "bn-BD", label: "Bengali", nativeName: "বাংলা", speechLocale: "bn-BD", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "ta", locale: "ta-IN", label: "Tamil", nativeName: "தமிழ்", speechLocale: "ta-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "te", locale: "te-IN", label: "Telugu", nativeName: "తెలుగు", speechLocale: "te-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "mr", locale: "mr-IN", label: "Marathi", nativeName: "मराठी", speechLocale: "mr-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "gu", locale: "gu-IN", label: "Gujarati", nativeName: "ગુજરાતી", speechLocale: "gu-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "kn", locale: "kn-IN", label: "Kannada", nativeName: "ಕನ್ನಡ", speechLocale: "kn-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "ml", locale: "ml-IN", label: "Malayalam", nativeName: "മലയാളം", speechLocale: "ml-IN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  // Punjabi: not confirmed on the documented list -- registry-only.
  define({ code: "pa", locale: "pa-IN", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ", speechLocale: "pa-IN", uiSupportLevel: "none", conversationSupported: false, sttSupported: false, ttsSupported: true }),

  // Southeast Asian
  define({ code: "vi", locale: "vi-VN", label: "Vietnamese", nativeName: "Tiếng Việt", speechLocale: "vi-VN", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "th", locale: "th-TH", label: "Thai", nativeName: "ไทย", speechLocale: "th-TH", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  define({ code: "id", locale: "id-ID", label: "Indonesian", nativeName: "Bahasa Indonesia", speechLocale: "id-ID", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
  // Malay/Filipino: not confirmed on the documented list -- registry-only.
  define({ code: "ms", locale: "ms-MY", label: "Malay", nativeName: "Bahasa Melayu", speechLocale: "ms-MY", uiSupportLevel: "none", conversationSupported: false, sttSupported: false, ttsSupported: true }),
  define({ code: "fil", locale: "fil-PH", label: "Filipino", nativeName: "Filipino", speechLocale: "fil-PH", uiSupportLevel: "none", conversationSupported: false, sttSupported: false, ttsSupported: true }),

  // African
  define({ code: "sw", locale: "sw-KE", label: "Swahili", nativeName: "Kiswahili", speechLocale: "sw-KE", uiSupportLevel: "none", conversationSupported: true, sttSupported: true, ttsSupported: true }),
];

const REGISTRY_BY_CODE: Map<LanguageCode, LanguageDefinition> = new Map(
  LANGUAGE_REGISTRY.map((entry) => [entry.code, entry]),
);

export const LANGUAGE_CODES: LanguageCode[] = LANGUAGE_REGISTRY.map((entry) => entry.code);

export function isLanguageCode(value: string): boolean {
  return REGISTRY_BY_CODE.has(value);
}

// Narrower than isLanguageCode: true only for a registry entry Gemini can
// actually converse in today, not merely a known/prepared entry. The one
// validation the chat route's request body and the Consult AI selector
// use, so "is this code usable for a conversation" is answered in
// exactly one place -- and Gemini's own RESPONSE_SCHEMA enum
// (consultation-chat-provider-gemini.ts) is built from this same list,
// so it can never drift from what the provider is actually asked to
// support.
export function isConversationLanguageCode(value: string): boolean {
  return REGISTRY_BY_CODE.get(value)?.conversationSupported === true;
}

// Narrower than isLanguageCode, independent of isConversationLanguageCode
// (see the type-level doc comment above for why these are tracked
// separately even though, for this app's specific provider, they happen
// to share the same true/false set today) -- the voice-transcript
// route's own STT-hint gate uses this specifically, not
// isConversationLanguageCode, so the two can evolve independently if a
// future provider ever supports one without the other.
export function isSttLanguageCode(value: string): boolean {
  return REGISTRY_BY_CODE.get(value)?.sttSupported === true;
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

// Case-insensitive substring match against a language's native name,
// English label, or code -- the filter behind the searchable language
// selector (see components/ui/language-selector.tsx). A flat list
// already works fine at ~18 UI-supported entries, but Consult AI's own
// conversation selector lists 40+ -- built now so the same component
// scales as more languages gain UI translations too, per the explicit
// requirement that the selector "trebuie să scaleze."
export function filterLanguages(languages: LanguageDefinition[], query: string): LanguageDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return languages;
  return languages.filter(
    (entry) =>
      entry.nativeName.toLowerCase().includes(normalized) ||
      entry.label.toLowerCase().includes(normalized) ||
      entry.code.toLowerCase().includes(normalized),
  );
}

// LOCALE vs LANGUAGE (regional variants): the registry deliberately does
// NOT collapse e.g. English into one entry with a hidden region field --
// `code` is the per-VARIANT identity (see zh-Hans/zh-Hant above, already
// modeled this way), and `locale` carries the fuller BCP-47 region tag.
// A future regional variant (en-GB, pt-BR, es-MX, fr-CA, ...) is simply a
// NEW entry with its own `code` (e.g. "en-GB") -- isLanguageCode,
// parseLanguageCode, User.locale's storage (a plain string column, no DB
// enum), and every consumer of LanguageCode already accept an arbitrary
// string, so adding one is a data change here, never a schema migration
// or a component refactor. None are added in this pass (no UI/AI-side
// reason to distinguish them yet), but nothing about this architecture
// blocks it later.
