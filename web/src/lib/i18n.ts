export type SupportedLocale = "en" | "ro";

export const DEFAULT_LOCALE: SupportedLocale = "en";

export function resolveLocale(input?: string | null): SupportedLocale {
  if (!input) {
    return DEFAULT_LOCALE;
  }

  const lowered = input.toLowerCase();
  if (lowered.startsWith("ro")) {
    return "ro";
  }

  return "en";
}

export const dictionary = {
  en: {
    milestoneTitle: "Milestone 1 - Foundation",
    authTitle: "Account",
    signIn: "Sign in",
    signOut: "Sign out",
    register: "Register",
    createClient: "Create client",
    clients: "Clients",
    language: "Language"
  },
  ro: {
    milestoneTitle: "Milestone 1 - Fundatie",
    authTitle: "Cont",
    signIn: "Autentificare",
    signOut: "Deconectare",
    register: "Inregistrare",
    createClient: "Creeaza client",
    clients: "Clienti",
    language: "Limba"
  }
} as const;
