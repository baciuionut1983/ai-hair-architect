import { LANGUAGE_CODES, type LanguageCode } from "./language-registry";

// Centralized UI string dictionary -- deliberately NOT hardcoded strings
// scattered through JSX. A new language is added by adding one more
// dictionary entry below (and, for languages not yet in it, translate()
// falls back to English) -- no component needs to change.
//
// Scope, stated honestly (see language-registry.ts's uiSupportLevel):
// every key below IS translated for all seven active languages (en, ro,
// ar, it, fr, de, es) -- this covers the shared app shell (navigation,
// topbar, the language selector itself, Consult AI's own chrome). It is
// NOT a full-app translation: History, AI Analysis, Teach the AI, and
// account/billing page CONTENT are not covered by this key set yet, which
// is exactly why ar/it/fr/de/es are marked "beta" in the registry rather
// than "full" -- en/ro are the only two with complete app-wide coverage
// today. Extending an existing language beyond this shell, or adding a
// new one, means adding keys/dictionaries here, never touching a
// component's JSX.
export type TranslationKey =
  | "nav.dashboard"
  | "nav.clients"
  | "nav.appointments"
  | "nav.academy"
  | "nav.marketplace"
  | "nav.account"
  | "topbar.logout"
  | "language.label"
  | "consultAi.voiceReply"
  | "consultAi.stop"
  | "consultAi.send"
  | "consultAi.typeMessage"
  | "consultAi.listening"
  | "consultAi.processing"
  | "consultAi.aiResponding"
  | "consultAi.speaking"
  | "common.on"
  | "common.off";

type Dictionary = Record<TranslationKey, string>;

const EN: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.clients": "Clients",
  "nav.appointments": "Appointments",
  "nav.academy": "Academy",
  "nav.marketplace": "Marketplace",
  "nav.account": "Account & Subscription",
  "topbar.logout": "Log out",
  "language.label": "Language",
  "consultAi.voiceReply": "Voice Reply",
  "consultAi.stop": "Stop",
  "consultAi.send": "Send",
  "consultAi.typeMessage": "Type a message...",
  "consultAi.listening": "Listening...",
  "consultAi.processing": "Processing...",
  "consultAi.aiResponding": "AI responding...",
  "consultAi.speaking": "Speaking...",
  "common.on": "On",
  "common.off": "Off",
};

const RO: Dictionary = {
  "nav.dashboard": "Tablou de bord",
  "nav.clients": "Clienți",
  "nav.appointments": "Programări",
  "nav.academy": "Academie",
  "nav.marketplace": "Magazin",
  "nav.account": "Cont și abonament",
  "topbar.logout": "Deconectare",
  "language.label": "Limbă",
  "consultAi.voiceReply": "Răspuns vocal",
  "consultAi.stop": "Oprește",
  "consultAi.send": "Trimite",
  "consultAi.typeMessage": "Scrie un mesaj...",
  "consultAi.listening": "Ascult...",
  "consultAi.processing": "Se procesează...",
  "consultAi.aiResponding": "AI răspunde...",
  "consultAi.speaking": "Vorbește...",
  "common.on": "Activ",
  "common.off": "Inactiv",
};

const AR: Dictionary = {
  "nav.dashboard": "لوحة التحكم",
  "nav.clients": "العملاء",
  "nav.appointments": "المواعيد",
  "nav.academy": "الأكاديمية",
  "nav.marketplace": "المتجر",
  "nav.account": "الحساب والاشتراك",
  "topbar.logout": "تسجيل الخروج",
  "language.label": "اللغة",
  "consultAi.voiceReply": "الرد الصوتي",
  "consultAi.stop": "إيقاف",
  "consultAi.send": "إرسال",
  "consultAi.typeMessage": "اكتب رسالة...",
  "consultAi.listening": "أستمع...",
  "consultAi.processing": "جارٍ المعالجة...",
  "consultAi.aiResponding": "الذكاء الاصطناعي يرد...",
  "consultAi.speaking": "يتحدث...",
  "common.on": "مفعّل",
  "common.off": "غير مفعّل",
};

const IT: Dictionary = {
  "nav.dashboard": "Cruscotto",
  "nav.clients": "Clienti",
  "nav.appointments": "Appuntamenti",
  "nav.academy": "Accademia",
  "nav.marketplace": "Mercato",
  "nav.account": "Account e abbonamento",
  "topbar.logout": "Esci",
  "language.label": "Lingua",
  "consultAi.voiceReply": "Risposta vocale",
  "consultAi.stop": "Ferma",
  "consultAi.send": "Invia",
  "consultAi.typeMessage": "Scrivi un messaggio...",
  "consultAi.listening": "In ascolto...",
  "consultAi.processing": "Elaborazione...",
  "consultAi.aiResponding": "L'IA sta rispondendo...",
  "consultAi.speaking": "Sta parlando...",
  "common.on": "Attivo",
  "common.off": "Disattivo",
};

const FR: Dictionary = {
  "nav.dashboard": "Tableau de bord",
  "nav.clients": "Clients",
  "nav.appointments": "Rendez-vous",
  "nav.academy": "Académie",
  "nav.marketplace": "Boutique",
  "nav.account": "Compte et abonnement",
  "topbar.logout": "Déconnexion",
  "language.label": "Langue",
  "consultAi.voiceReply": "Réponse vocale",
  "consultAi.stop": "Arrêter",
  "consultAi.send": "Envoyer",
  "consultAi.typeMessage": "Écrivez un message...",
  "consultAi.listening": "Écoute en cours...",
  "consultAi.processing": "Traitement en cours...",
  "consultAi.aiResponding": "L'IA répond...",
  "consultAi.speaking": "En train de parler...",
  "common.on": "Activé",
  "common.off": "Désactivé",
};

const DE: Dictionary = {
  "nav.dashboard": "Übersicht",
  "nav.clients": "Kunden",
  "nav.appointments": "Termine",
  "nav.academy": "Akademie",
  "nav.marketplace": "Marktplatz",
  "nav.account": "Konto & Abo",
  "topbar.logout": "Abmelden",
  "language.label": "Sprache",
  "consultAi.voiceReply": "Sprachantwort",
  "consultAi.stop": "Stopp",
  "consultAi.send": "Senden",
  "consultAi.typeMessage": "Nachricht schreiben...",
  "consultAi.listening": "Hört zu...",
  "consultAi.processing": "Wird verarbeitet...",
  "consultAi.aiResponding": "KI antwortet...",
  "consultAi.speaking": "Spricht...",
  "common.on": "Ein",
  "common.off": "Aus",
};

const ES: Dictionary = {
  "nav.dashboard": "Panel",
  "nav.clients": "Clientes",
  "nav.appointments": "Citas",
  "nav.academy": "Academia",
  "nav.marketplace": "Mercado",
  "nav.account": "Cuenta y suscripción",
  "topbar.logout": "Cerrar sesión",
  "language.label": "Idioma",
  "consultAi.voiceReply": "Respuesta de voz",
  "consultAi.stop": "Detener",
  "consultAi.send": "Enviar",
  "consultAi.typeMessage": "Escribe un mensaje...",
  "consultAi.listening": "Escuchando...",
  "consultAi.processing": "Procesando...",
  "consultAi.aiResponding": "La IA está respondiendo...",
  "consultAi.speaking": "Hablando...",
  "common.on": "Activado",
  "common.off": "Desactivado",
};

const DICTIONARIES: Partial<Record<LanguageCode, Dictionary>> = {
  en: EN,
  ro: RO,
  ar: AR,
  it: IT,
  fr: FR,
  de: DE,
  es: ES,
};

// English is the universal fallback -- a language with no dictionary yet
// (any registry entry beyond the seven above) reads in English rather
// than showing a raw key or blank string, exactly like the beta-language
// honesty pattern already used for Voice Reply's "no voice installed"
// notice.
export function translate(language: LanguageCode, key: TranslationKey): string {
  return DICTIONARIES[language]?.[key] ?? EN[key];
}

// For tests/tooling that want to confirm a given language's dictionary
// has no gaps against the full key set.
export function hasCompleteDictionary(language: LanguageCode): boolean {
  const dictionary = DICTIONARIES[language];
  if (!dictionary) return false;
  return Object.keys(EN).every((key) => Boolean(dictionary[key as TranslationKey]));
}

export const TRANSLATED_LANGUAGE_CODES: LanguageCode[] = LANGUAGE_CODES.filter((code) => Boolean(DICTIONARIES[code]));
