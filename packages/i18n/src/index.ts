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

export const i18nDictionary = {
  en: {
    appTitle: "AI Hair Architect",
    authTitle: "Account",
    signIn: "Sign in",
    signOut: "Sign out",
    createClient: "Create client",
    clients: "Clients"
  },
  ro: {
    appTitle: "AI Hair Architect",
    authTitle: "Cont",
    signIn: "Autentificare",
    signOut: "Deconectare",
    createClient: "Creeaza client",
    clients: "Clienti"
  }
} as const;
