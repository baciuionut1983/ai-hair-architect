import { LANGUAGE_CODES, type LanguageCode } from "./language-registry";

// Centralized UI string dictionary -- deliberately NOT hardcoded strings
// scattered through JSX. A new language is added by adding one more
// dictionary entry below (and, for languages not yet in it, translate()
// falls back to English) -- no component needs to change.
//
// Scope, stated honestly (see language-registry.ts's uiSupportLevel):
// every key below IS translated for all eighteen UI-supported languages
// (en, ro, ar, it, fr, de, es, pt, nl, pl, tr, el, he, ja, ko, zh-Hans,
// zh-Hant, hi) -- this covers the shared app shell (navigation, topbar,
// the language selector itself, Consult AI's own chrome). It is NOT a
// full-app translation: History, AI Analysis, Teach the AI, and
// account/billing page CONTENT are not covered by this key set yet, which
// is exactly why every language but en/ro is marked "beta" in the
// registry rather than "full" -- en/ro are the only two with complete
// app-wide coverage today. Extending an existing language beyond this
// shell, or adding a new one, means adding keys/dictionaries here, never
// touching a component's JSX.
export type TranslationKey =
  | "nav.dashboard"
  | "nav.clients"
  | "nav.appointments"
  | "nav.academy"
  | "nav.marketplace"
  | "nav.account"
  | "topbar.logout"
  | "language.label"
  | "language.search"
  | "language.auto"
  | "language.noMatches"
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
  "language.search": "Search language...",
  "language.auto": "Auto",
  "language.noMatches": "No matches",
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
  "language.search": "Caută limbă...",
  "language.auto": "Automat",
  "language.noMatches": "Nicio potrivire",
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
  "language.search": "ابحث عن لغة...",
  "language.auto": "تلقائي",
  "language.noMatches": "لا توجد نتائج",
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
  "language.search": "Cerca lingua...",
  "language.auto": "Automatico",
  "language.noMatches": "Nessun risultato",
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
  "language.search": "Rechercher une langue...",
  "language.auto": "Automatique",
  "language.noMatches": "Aucun résultat",
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
  "language.search": "Sprache suchen...",
  "language.auto": "Automatisch",
  "language.noMatches": "Keine Treffer",
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
  "language.search": "Buscar idioma...",
  "language.auto": "Automático",
  "language.noMatches": "Sin resultados",
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

const PT: Dictionary = {
  "nav.dashboard": "Painel",
  "nav.clients": "Clientes",
  "nav.appointments": "Marcações",
  "nav.academy": "Academia",
  "nav.marketplace": "Mercado",
  "nav.account": "Conta e subscrição",
  "topbar.logout": "Terminar sessão",
  "language.label": "Idioma",
  "language.search": "Pesquisar idioma...",
  "language.auto": "Automático",
  "language.noMatches": "Sem resultados",
  "consultAi.voiceReply": "Resposta de voz",
  "consultAi.stop": "Parar",
  "consultAi.send": "Enviar",
  "consultAi.typeMessage": "Escreva uma mensagem...",
  "consultAi.listening": "A ouvir...",
  "consultAi.processing": "A processar...",
  "consultAi.aiResponding": "A IA está a responder...",
  "consultAi.speaking": "A falar...",
  "common.on": "Ativado",
  "common.off": "Desativado",
};

const NL: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.clients": "Klanten",
  "nav.appointments": "Afspraken",
  "nav.academy": "Academie",
  "nav.marketplace": "Marktplaats",
  "nav.account": "Account en abonnement",
  "topbar.logout": "Uitloggen",
  "language.label": "Taal",
  "language.search": "Taal zoeken...",
  "language.auto": "Automatisch",
  "language.noMatches": "Geen resultaten",
  "consultAi.voiceReply": "Spraakantwoord",
  "consultAi.stop": "Stoppen",
  "consultAi.send": "Verzenden",
  "consultAi.typeMessage": "Typ een bericht...",
  "consultAi.listening": "Luisteren...",
  "consultAi.processing": "Verwerken...",
  "consultAi.aiResponding": "AI antwoordt...",
  "consultAi.speaking": "Spreekt...",
  "common.on": "Aan",
  "common.off": "Uit",
};

const PL: Dictionary = {
  "nav.dashboard": "Panel",
  "nav.clients": "Klienci",
  "nav.appointments": "Wizyty",
  "nav.academy": "Akademia",
  "nav.marketplace": "Sklep",
  "nav.account": "Konto i subskrypcja",
  "topbar.logout": "Wyloguj się",
  "language.label": "Język",
  "language.search": "Szukaj języka...",
  "language.auto": "Automatyczny",
  "language.noMatches": "Brak wyników",
  "consultAi.voiceReply": "Odpowiedź głosowa",
  "consultAi.stop": "Zatrzymaj",
  "consultAi.send": "Wyślij",
  "consultAi.typeMessage": "Napisz wiadomość...",
  "consultAi.listening": "Słucham...",
  "consultAi.processing": "Przetwarzanie...",
  "consultAi.aiResponding": "AI odpowiada...",
  "consultAi.speaking": "Mówi...",
  "common.on": "Włączone",
  "common.off": "Wyłączone",
};

const TR: Dictionary = {
  "nav.dashboard": "Panel",
  "nav.clients": "Müşteriler",
  "nav.appointments": "Randevular",
  "nav.academy": "Akademi",
  "nav.marketplace": "Pazar Yeri",
  "nav.account": "Hesap ve Abonelik",
  "topbar.logout": "Çıkış yap",
  "language.label": "Dil",
  "language.search": "Dil ara...",
  "language.auto": "Otomatik",
  "language.noMatches": "Sonuç yok",
  "consultAi.voiceReply": "Sesli Yanıt",
  "consultAi.stop": "Durdur",
  "consultAi.send": "Gönder",
  "consultAi.typeMessage": "Bir mesaj yazın...",
  "consultAi.listening": "Dinleniyor...",
  "consultAi.processing": "İşleniyor...",
  "consultAi.aiResponding": "Yapay zeka yanıt veriyor...",
  "consultAi.speaking": "Konuşuyor...",
  "common.on": "Açık",
  "common.off": "Kapalı",
};

const EL: Dictionary = {
  "nav.dashboard": "Πίνακας ελέγχου",
  "nav.clients": "Πελάτες",
  "nav.appointments": "Ραντεβού",
  "nav.academy": "Ακαδημία",
  "nav.marketplace": "Αγορά",
  "nav.account": "Λογαριασμός & Συνδρομή",
  "topbar.logout": "Αποσύνδεση",
  "language.label": "Γλώσσα",
  "language.search": "Αναζήτηση γλώσσας...",
  "language.auto": "Αυτόματο",
  "language.noMatches": "Δεν βρέθηκαν αποτελέσματα",
  "consultAi.voiceReply": "Φωνητική απάντηση",
  "consultAi.stop": "Διακοπή",
  "consultAi.send": "Αποστολή",
  "consultAi.typeMessage": "Πληκτρολογήστε ένα μήνυμα...",
  "consultAi.listening": "Ακούει...",
  "consultAi.processing": "Επεξεργασία...",
  "consultAi.aiResponding": "Η IA απαντά...",
  "consultAi.speaking": "Μιλάει...",
  "common.on": "Ενεργό",
  "common.off": "Ανενεργό",
};

const HE: Dictionary = {
  "nav.dashboard": "לוח בקרה",
  "nav.clients": "לקוחות",
  "nav.appointments": "פגישות",
  "nav.academy": "אקדמיה",
  "nav.marketplace": "חנות",
  "nav.account": "חשבון ומינוי",
  "topbar.logout": "התנתקות",
  "language.label": "שפה",
  "language.search": "חיפוש שפה...",
  "language.auto": "אוטומטי",
  "language.noMatches": "אין תוצאות",
  "consultAi.voiceReply": "תשובה קולית",
  "consultAi.stop": "עצור",
  "consultAi.send": "שלח",
  "consultAi.typeMessage": "הקלד/י הודעה...",
  "consultAi.listening": "מקשיב...",
  "consultAi.processing": "מעבד...",
  "consultAi.aiResponding": "הבינה המלאכותית משיבה...",
  "consultAi.speaking": "מדבר...",
  "common.on": "פעיל",
  "common.off": "כבוי",
};

const JA: Dictionary = {
  "nav.dashboard": "ダッシュボード",
  "nav.clients": "クライアント",
  "nav.appointments": "予約",
  "nav.academy": "アカデミー",
  "nav.marketplace": "マーケットプレイス",
  "nav.account": "アカウントと購読",
  "topbar.logout": "ログアウト",
  "language.label": "言語",
  "language.search": "言語を検索...",
  "language.auto": "自動",
  "language.noMatches": "一致する結果がありません",
  "consultAi.voiceReply": "音声応答",
  "consultAi.stop": "停止",
  "consultAi.send": "送信",
  "consultAi.typeMessage": "メッセージを入力...",
  "consultAi.listening": "聞いています...",
  "consultAi.processing": "処理中...",
  "consultAi.aiResponding": "AIが応答しています...",
  "consultAi.speaking": "話しています...",
  "common.on": "オン",
  "common.off": "オフ",
};

const KO: Dictionary = {
  "nav.dashboard": "대시보드",
  "nav.clients": "고객",
  "nav.appointments": "예약",
  "nav.academy": "아카데미",
  "nav.marketplace": "마켓플레이스",
  "nav.account": "계정 및 구독",
  "topbar.logout": "로그아웃",
  "language.label": "언어",
  "language.search": "언어 검색...",
  "language.auto": "자동",
  "language.noMatches": "일치하는 결과 없음",
  "consultAi.voiceReply": "음성 응답",
  "consultAi.stop": "중지",
  "consultAi.send": "보내기",
  "consultAi.typeMessage": "메시지를 입력하세요...",
  "consultAi.listening": "듣는 중...",
  "consultAi.processing": "처리 중...",
  "consultAi.aiResponding": "AI가 응답 중...",
  "consultAi.speaking": "말하는 중...",
  "common.on": "켜짐",
  "common.off": "꺼짐",
};

const ZH_HANS: Dictionary = {
  "nav.dashboard": "仪表盘",
  "nav.clients": "客户",
  "nav.appointments": "预约",
  "nav.academy": "学院",
  "nav.marketplace": "市场",
  "nav.account": "账户与订阅",
  "topbar.logout": "退出登录",
  "language.label": "语言",
  "language.search": "搜索语言...",
  "language.auto": "自动",
  "language.noMatches": "没有匹配结果",
  "consultAi.voiceReply": "语音回复",
  "consultAi.stop": "停止",
  "consultAi.send": "发送",
  "consultAi.typeMessage": "输入消息...",
  "consultAi.listening": "正在聆听...",
  "consultAi.processing": "正在处理...",
  "consultAi.aiResponding": "AI 正在回复...",
  "consultAi.speaking": "正在说话...",
  "common.on": "开启",
  "common.off": "关闭",
};

const ZH_HANT: Dictionary = {
  "nav.dashboard": "儀表板",
  "nav.clients": "客戶",
  "nav.appointments": "預約",
  "nav.academy": "學院",
  "nav.marketplace": "市場",
  "nav.account": "帳戶與訂閱",
  "topbar.logout": "登出",
  "language.label": "語言",
  "language.search": "搜尋語言...",
  "language.auto": "自動",
  "language.noMatches": "沒有符合的結果",
  "consultAi.voiceReply": "語音回覆",
  "consultAi.stop": "停止",
  "consultAi.send": "傳送",
  "consultAi.typeMessage": "輸入訊息...",
  "consultAi.listening": "正在聆聽...",
  "consultAi.processing": "處理中...",
  "consultAi.aiResponding": "AI 正在回覆...",
  "consultAi.speaking": "正在說話...",
  "common.on": "開啟",
  "common.off": "關閉",
};

const HI: Dictionary = {
  "nav.dashboard": "डैशबोर्ड",
  "nav.clients": "ग्राहक",
  "nav.appointments": "अपॉइंटमेंट",
  "nav.academy": "अकादमी",
  "nav.marketplace": "मार्केटप्लेस",
  "nav.account": "खाता और सदस्यता",
  "topbar.logout": "लॉग आउट",
  "language.label": "भाषा",
  "language.search": "भाषा खोजें...",
  "language.auto": "ऑटो",
  "language.noMatches": "कोई मिलान नहीं",
  "consultAi.voiceReply": "आवाज़ जवाब",
  "consultAi.stop": "रोकें",
  "consultAi.send": "भेजें",
  "consultAi.typeMessage": "संदेश लिखें...",
  "consultAi.listening": "सुन रहा है...",
  "consultAi.processing": "प्रोसेस हो रहा है...",
  "consultAi.aiResponding": "AI जवाब दे रहा है...",
  "consultAi.speaking": "बोल रहा है...",
  "common.on": "चालू",
  "common.off": "बंद",
};

const DICTIONARIES: Partial<Record<LanguageCode, Dictionary>> = {
  en: EN,
  ro: RO,
  ar: AR,
  it: IT,
  fr: FR,
  de: DE,
  es: ES,
  pt: PT,
  nl: NL,
  pl: PL,
  tr: TR,
  el: EL,
  he: HE,
  ja: JA,
  ko: KO,
  "zh-Hans": ZH_HANS,
  "zh-Hant": ZH_HANT,
  hi: HI,
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
