"use client";

import type { LanguageCode } from "@/lib/language-registry";
import { uiSupportedLanguages } from "@/lib/language-registry";

import { Select } from "./select";

export interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (next: LanguageCode) => void;
  label: string;
  className?: string;
}

// The GLOBAL UI language selector -- lists every language with a real
// (full or beta) UI translation, driven entirely by language-registry.ts
// so a newly activated language appears here automatically, with no
// component change. A "(Beta)" suffix is the honest signal for a
// language whose app-wide translation isn't complete yet (see
// translations.ts's own coverage note) -- never silently presented as
// equivalent to the two fully translated languages.
export function LanguageSelector({ value, onChange, label, className }: LanguageSelectorProps) {
  return (
    <div className={className}>
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {uiSupportedLanguages().map((entry) => (
          <option key={entry.code} value={entry.code}>
            🌐 {entry.nativeName}
            {entry.uiSupportLevel === "beta" ? " (Beta)" : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}
