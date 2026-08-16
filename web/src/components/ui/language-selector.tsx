"use client";

import type { LanguageCode } from "@/lib/language-registry";
import { uiSupportedLanguages } from "@/lib/language-registry";

import { LanguageCombobox } from "./language-combobox";

export interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (next: LanguageCode) => void;
  label: string;
  className?: string;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
}

// The GLOBAL UI language selector -- lists every language with a real
// (full or beta) UI translation, driven entirely by language-registry.ts
// so a newly activated language appears here automatically, with no
// component change. A "(Beta)" suffix is the honest signal for a
// language whose app-wide translation isn't complete yet (see
// translations.ts's own coverage note) -- never silently presented as
// equivalent to the two fully translated languages. Search text and empty
// placeholders default to English literals for callers that don't thread
// the translated strings through -- (app)/layout.tsx passes the real
// translated ones via useUiLanguage()'s t().
export function LanguageSelector({
  value,
  onChange,
  label,
  className,
  searchPlaceholder = "Search language...",
  noMatchesLabel = "No matches",
}: LanguageSelectorProps) {
  return (
    <LanguageCombobox
      languages={uiSupportedLanguages()}
      value={value}
      onChange={(next) => onChange(next as LanguageCode)}
      ariaLabel={label}
      searchPlaceholder={searchPlaceholder}
      noMatchesLabel={noMatchesLabel}
      className={className}
    />
  );
}
