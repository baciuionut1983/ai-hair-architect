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
  | "consultAi.generatingVoice"
  | "consultAi.proposedDirection.badge"
  | "consultAi.proposedDirection.directionLabel"
  | "consultAi.proposedDirection.whyLabel"
  | "consultAi.proposedDirection.statusPending"
  | "consultAi.proposedDirection.statusApplied"
  | "consultAi.proposedDirection.applyButton"
  | "consultAi.proposedDirection.noAnalysisExplain"
  | "consultAi.proposedDirection.noAnalysisLink"
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
  "consultAi.generatingVoice": "Generating voice...",
  "consultAi.proposedDirection.badge": "AI Proposed Direction",
  "consultAi.proposedDirection.directionLabel": "Proposed direction",
  "consultAi.proposedDirection.whyLabel": "Why AI recommends this",
  "consultAi.proposedDirection.statusPending": "Proposed — not applied yet",
  "consultAi.proposedDirection.statusApplied": "Applied to this client's analysis",
  "consultAi.proposedDirection.applyButton": "Apply this direction",
  "consultAi.proposedDirection.noAnalysisExplain":
    "This is a professional suggestion only — it hasn't been saved to a plan yet. Applying it needs a specific analysis.",
  "consultAi.proposedDirection.noAnalysisLink": "Open this client's analyses",
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
  "consultAi.generatingVoice": "Se generează vocea...",
  "consultAi.proposedDirection.badge": "Direcție propusă de AI",
  "consultAi.proposedDirection.directionLabel": "Direcție propusă",
  "consultAi.proposedDirection.whyLabel": "De ce recomandă AI asta",
  "consultAi.proposedDirection.statusPending": "Propus — nu este încă aplicat",
  "consultAi.proposedDirection.statusApplied": "Aplicat la analiza acestui client",
  "consultAi.proposedDirection.applyButton": "Aplică această direcție",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Aceasta este doar o sugestie profesională — nu a fost încă salvată într-un plan. Pentru a o aplica, este nevoie de o analiză specifică.",
  "consultAi.proposedDirection.noAnalysisLink": "Deschide analizele acestui client",
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
  "consultAi.generatingVoice": "جارٍ إنشاء الصوت...",
  "consultAi.proposedDirection.badge": "اتجاه مقترح من الذكاء الاصطناعي",
  "consultAi.proposedDirection.directionLabel": "الاتجاه المقترح",
  "consultAi.proposedDirection.whyLabel": "سبب توصية الذكاء الاصطناعي بهذا",
  "consultAi.proposedDirection.statusPending": "مقترح — لم يُطبَّق بعد",
  "consultAi.proposedDirection.statusApplied": "تم تطبيقه على تحليل هذا العميل",
  "consultAi.proposedDirection.applyButton": "تطبيق هذا الاتجاه",
  "consultAi.proposedDirection.noAnalysisExplain":
    "هذا مجرد اقتراح مهني — لم يُحفظ بعد في خطة. لتطبيقه، يلزم وجود تحليل محدد.",
  "consultAi.proposedDirection.noAnalysisLink": "افتح تحليلات هذا العميل",
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
  "consultAi.generatingVoice": "Generazione voce...",
  "consultAi.proposedDirection.badge": "Direzione proposta dall'IA",
  "consultAi.proposedDirection.directionLabel": "Direzione proposta",
  "consultAi.proposedDirection.whyLabel": "Perché l'IA lo consiglia",
  "consultAi.proposedDirection.statusPending": "Proposto — non ancora applicato",
  "consultAi.proposedDirection.statusApplied": "Applicato all'analisi di questo cliente",
  "consultAi.proposedDirection.applyButton": "Applica questa direzione",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Questo è solo un suggerimento professionale — non è stato ancora salvato in un piano. Per applicarlo serve un'analisi specifica.",
  "consultAi.proposedDirection.noAnalysisLink": "Apri le analisi di questo cliente",
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
  "consultAi.generatingVoice": "Génération de la voix...",
  "consultAi.proposedDirection.badge": "Direction proposée par l'IA",
  "consultAi.proposedDirection.directionLabel": "Direction proposée",
  "consultAi.proposedDirection.whyLabel": "Pourquoi l'IA recommande cela",
  "consultAi.proposedDirection.statusPending": "Proposé — pas encore appliqué",
  "consultAi.proposedDirection.statusApplied": "Appliqué à l'analyse de ce client",
  "consultAi.proposedDirection.applyButton": "Appliquer cette direction",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Il s'agit uniquement d'une suggestion professionnelle — elle n'a pas encore été enregistrée dans un plan. Pour l'appliquer, une analyse spécifique est nécessaire.",
  "consultAi.proposedDirection.noAnalysisLink": "Ouvrir les analyses de ce client",
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
  "consultAi.generatingVoice": "Stimme wird generiert...",
  "consultAi.proposedDirection.badge": "KI-vorgeschlagene Richtung",
  "consultAi.proposedDirection.directionLabel": "Vorgeschlagene Richtung",
  "consultAi.proposedDirection.whyLabel": "Warum die KI dies empfiehlt",
  "consultAi.proposedDirection.statusPending": "Vorgeschlagen — noch nicht übernommen",
  "consultAi.proposedDirection.statusApplied": "Auf die Analyse dieses Kunden angewendet",
  "consultAi.proposedDirection.applyButton": "Diese Richtung übernehmen",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Dies ist nur ein fachlicher Vorschlag — er wurde noch nicht in einem Plan gespeichert. Zum Übernehmen ist eine bestimmte Analyse erforderlich.",
  "consultAi.proposedDirection.noAnalysisLink": "Analysen dieses Kunden öffnen",
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
  "consultAi.generatingVoice": "Generando voz...",
  "consultAi.proposedDirection.badge": "Dirección propuesta por la IA",
  "consultAi.proposedDirection.directionLabel": "Dirección propuesta",
  "consultAi.proposedDirection.whyLabel": "Por qué la IA recomienda esto",
  "consultAi.proposedDirection.statusPending": "Propuesto — aún no aplicado",
  "consultAi.proposedDirection.statusApplied": "Aplicado al análisis de este cliente",
  "consultAi.proposedDirection.applyButton": "Aplicar esta dirección",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Esto es solo una sugerencia profesional — todavía no se ha guardado en un plan. Para aplicarla, se necesita un análisis específico.",
  "consultAi.proposedDirection.noAnalysisLink": "Abrir los análisis de este cliente",
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
  "consultAi.generatingVoice": "A gerar voz...",
  "consultAi.proposedDirection.badge": "Direção proposta pela IA",
  "consultAi.proposedDirection.directionLabel": "Direção proposta",
  "consultAi.proposedDirection.whyLabel": "Porque é que a IA recomenda isto",
  "consultAi.proposedDirection.statusPending": "Proposto — ainda não aplicado",
  "consultAi.proposedDirection.statusApplied": "Aplicado à análise deste cliente",
  "consultAi.proposedDirection.applyButton": "Aplicar esta direção",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Isto é apenas uma sugestão profissional — ainda não foi guardada num plano. Para a aplicar, é necessária uma análise específica.",
  "consultAi.proposedDirection.noAnalysisLink": "Abrir as análises deste cliente",
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
  "consultAi.generatingVoice": "Stem wordt gegenereerd...",
  "consultAi.proposedDirection.badge": "Door AI voorgestelde richting",
  "consultAi.proposedDirection.directionLabel": "Voorgestelde richting",
  "consultAi.proposedDirection.whyLabel": "Waarom AI dit aanbeveelt",
  "consultAi.proposedDirection.statusPending": "Voorgesteld — nog niet toegepast",
  "consultAi.proposedDirection.statusApplied": "Toegepast op de analyse van deze klant",
  "consultAi.proposedDirection.applyButton": "Deze richting toepassen",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Dit is alleen een professionele suggestie — nog niet opgeslagen in een plan. Om dit toe te passen is een specifieke analyse nodig.",
  "consultAi.proposedDirection.noAnalysisLink": "Analyses van deze klant openen",
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
  "consultAi.generatingVoice": "Generowanie głosu...",
  "consultAi.proposedDirection.badge": "Kierunek zaproponowany przez AI",
  "consultAi.proposedDirection.directionLabel": "Proponowany kierunek",
  "consultAi.proposedDirection.whyLabel": "Dlaczego AI to zaleca",
  "consultAi.proposedDirection.statusPending": "Zaproponowano — jeszcze nie zastosowano",
  "consultAi.proposedDirection.statusApplied": "Zastosowano w analizie tego klienta",
  "consultAi.proposedDirection.applyButton": "Zastosuj ten kierunek",
  "consultAi.proposedDirection.noAnalysisExplain":
    "To tylko profesjonalna sugestia — nie została jeszcze zapisana w planie. Aby ją zastosować, potrzebna jest konkretna analiza.",
  "consultAi.proposedDirection.noAnalysisLink": "Otwórz analizy tego klienta",
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
  "consultAi.generatingVoice": "Ses oluşturuluyor...",
  "consultAi.proposedDirection.badge": "Yapay Zeka Tarafından Önerilen Yön",
  "consultAi.proposedDirection.directionLabel": "Önerilen yön",
  "consultAi.proposedDirection.whyLabel": "Yapay zeka bunu neden öneriyor",
  "consultAi.proposedDirection.statusPending": "Önerildi — henüz uygulanmadı",
  "consultAi.proposedDirection.statusApplied": "Bu müşterinin analizine uygulandı",
  "consultAi.proposedDirection.applyButton": "Bu yönü uygula",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Bu yalnızca profesyonel bir öneridir — henüz bir plana kaydedilmedi. Uygulamak için belirli bir analiz gereklidir.",
  "consultAi.proposedDirection.noAnalysisLink": "Bu müşterinin analizlerini aç",
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
  "consultAi.generatingVoice": "Δημιουργία φωνής...",
  "consultAi.proposedDirection.badge": "Κατεύθυνση που προτείνει η AI",
  "consultAi.proposedDirection.directionLabel": "Προτεινόμενη κατεύθυνση",
  "consultAi.proposedDirection.whyLabel": "Γιατί το προτείνει η AI",
  "consultAi.proposedDirection.statusPending": "Προτάθηκε — δεν έχει εφαρμοστεί ακόμη",
  "consultAi.proposedDirection.statusApplied": "Εφαρμόστηκε στην ανάλυση αυτού του πελάτη",
  "consultAi.proposedDirection.applyButton": "Εφαρμογή αυτής της κατεύθυνσης",
  "consultAi.proposedDirection.noAnalysisExplain":
    "Αυτή είναι μόνο μια επαγγελματική πρόταση — δεν έχει αποθηκευτεί ακόμη σε ένα πλάνο. Για να εφαρμοστεί, απαιτείται συγκεκριμένη ανάλυση.",
  "consultAi.proposedDirection.noAnalysisLink": "Άνοιγμα των αναλύσεων αυτού του πελάτη",
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
  "consultAi.generatingVoice": "מייצר קול...",
  "consultAi.proposedDirection.badge": "כיוון מוצע על ידי הבינה המלאכותית",
  "consultAi.proposedDirection.directionLabel": "כיוון מוצע",
  "consultAi.proposedDirection.whyLabel": "למה הבינה המלאכותית ממליצה על כך",
  "consultAi.proposedDirection.statusPending": "הוצע — טרם הוחל",
  "consultAi.proposedDirection.statusApplied": "הוחל על הניתוח של לקוח זה",
  "consultAi.proposedDirection.applyButton": "החל כיוון זה",
  "consultAi.proposedDirection.noAnalysisExplain":
    "זו רק המלצה מקצועית — היא עדיין לא נשמרה בתוכנית. כדי להחיל אותה, נדרש ניתוח ספציפי.",
  "consultAi.proposedDirection.noAnalysisLink": "פתח את הניתוחים של לקוח זה",
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
  "consultAi.generatingVoice": "音声を生成中...",
  "consultAi.proposedDirection.badge": "AIが提案する方向性",
  "consultAi.proposedDirection.directionLabel": "提案された方向性",
  "consultAi.proposedDirection.whyLabel": "AIがこれを勧める理由",
  "consultAi.proposedDirection.statusPending": "提案済み — まだ適用されていません",
  "consultAi.proposedDirection.statusApplied": "このクライアントの分析に適用されました",
  "consultAi.proposedDirection.applyButton": "この方向性を適用",
  "consultAi.proposedDirection.noAnalysisExplain":
    "これは専門的な提案にすぎません — まだプランに保存されていません。適用するには特定の分析が必要です。",
  "consultAi.proposedDirection.noAnalysisLink": "このクライアントの分析を開く",
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
  "consultAi.generatingVoice": "음성 생성 중...",
  "consultAi.proposedDirection.badge": "AI가 제안한 방향",
  "consultAi.proposedDirection.directionLabel": "제안된 방향",
  "consultAi.proposedDirection.whyLabel": "AI가 이를 추천하는 이유",
  "consultAi.proposedDirection.statusPending": "제안됨 — 아직 적용되지 않음",
  "consultAi.proposedDirection.statusApplied": "이 고객의 분석에 적용됨",
  "consultAi.proposedDirection.applyButton": "이 방향 적용하기",
  "consultAi.proposedDirection.noAnalysisExplain":
    "이것은 전문적인 제안일 뿐입니다 — 아직 플랜에 저장되지 않았습니다. 적용하려면 특정 분석이 필요합니다.",
  "consultAi.proposedDirection.noAnalysisLink": "이 고객의 분석 열기",
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
  "consultAi.generatingVoice": "正在生成语音...",
  "consultAi.proposedDirection.badge": "AI 建议的方向",
  "consultAi.proposedDirection.directionLabel": "建议的方向",
  "consultAi.proposedDirection.whyLabel": "AI 为何推荐此项",
  "consultAi.proposedDirection.statusPending": "已建议 — 尚未应用",
  "consultAi.proposedDirection.statusApplied": "已应用到此客户的分析",
  "consultAi.proposedDirection.applyButton": "应用此方向",
  "consultAi.proposedDirection.noAnalysisExplain":
    "这只是一个专业建议——尚未保存到方案中。要应用它，需要一个具体的分析。",
  "consultAi.proposedDirection.noAnalysisLink": "打开此客户的分析",
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
  "consultAi.generatingVoice": "正在產生語音...",
  "consultAi.proposedDirection.badge": "AI 建議的方向",
  "consultAi.proposedDirection.directionLabel": "建議的方向",
  "consultAi.proposedDirection.whyLabel": "AI 為何推薦此項",
  "consultAi.proposedDirection.statusPending": "已建議 — 尚未套用",
  "consultAi.proposedDirection.statusApplied": "已套用至此客戶的分析",
  "consultAi.proposedDirection.applyButton": "套用此方向",
  "consultAi.proposedDirection.noAnalysisExplain":
    "這只是一個專業建議——尚未儲存至方案中。要套用它，需要一個具體的分析。",
  "consultAi.proposedDirection.noAnalysisLink": "開啟此客戶的分析",
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
  "consultAi.generatingVoice": "आवाज़ बनाई जा रही है...",
  "consultAi.proposedDirection.badge": "AI द्वारा सुझाई गई दिशा",
  "consultAi.proposedDirection.directionLabel": "सुझाई गई दिशा",
  "consultAi.proposedDirection.whyLabel": "AI इसकी सिफ़ारिश क्यों कर रहा है",
  "consultAi.proposedDirection.statusPending": "सुझाया गया — अभी लागू नहीं हुआ",
  "consultAi.proposedDirection.statusApplied": "इस ग्राहक के विश्लेषण पर लागू किया गया",
  "consultAi.proposedDirection.applyButton": "यह दिशा लागू करें",
  "consultAi.proposedDirection.noAnalysisExplain":
    "यह केवल एक पेशेवर सुझाव है — इसे अभी तक किसी योजना में सहेजा नहीं गया है। इसे लागू करने के लिए एक विशिष्ट विश्लेषण आवश्यक है।",
  "consultAi.proposedDirection.noAnalysisLink": "इस ग्राहक के विश्लेषण खोलें",
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
