"use client";

// The app's GLOBAL UI language -- deliberately separate from Consult AI's
// own "conversation language" selector (consultation-chat-logic.ts's
// LanguageSelection): this context answers "what language are the menus/
// buttons/labels in," Consult AI's own state answers "what language is
// this specific conversation in." A Romanian UI setting must never force
// the AI to reply in Romanian to someone writing in Italian, and
// vice versa -- see consultation-chat.tsx, which reads its own
// independent state and never this context for conversation decisions.
//
// Deliberately no context value is required to render: a component
// rendered outside the provider (e.g. in a future standalone page, or a
// test) gets English rather than crashing.

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { LanguageCode } from "./language-registry";
import { translate, type TranslationKey } from "./translations";

export interface UiLanguageContextValue {
  language: LanguageCode;
  t: (key: TranslationKey) => string;
}

const UiLanguageContext = createContext<UiLanguageContextValue | null>(null);

export function UiLanguageProvider({ language, children }: { language: LanguageCode; children: ReactNode }) {
  const value = useMemo<UiLanguageContextValue>(
    () => ({ language, t: (key: TranslationKey) => translate(language, key) }),
    [language],
  );

  return <UiLanguageContext.Provider value={value}>{children}</UiLanguageContext.Provider>;
}

export function useUiLanguage(): UiLanguageContextValue {
  const context = useContext(UiLanguageContext);
  if (context) return context;
  return { language: "en", t: (key: TranslationKey) => translate("en", key) };
}
