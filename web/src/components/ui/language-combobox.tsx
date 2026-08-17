"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LanguageDefinition } from "@/lib/language-registry";
import { filterLanguages } from "@/lib/language-registry";

import { cn } from "./cn";
import { Input } from "./input";

export interface LanguageComboboxProps {
  languages: LanguageDefinition[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  searchPlaceholder: string;
  noMatchesLabel: string;
  className?: string;
  // An extra pinned entry above the searchable list (e.g. "Auto") that
  // isn't part of the language registry -- always visible, never filtered
  // out by the search query.
  leadingOption?: { value: string; display: string };
}

// A searchable dropdown for picking a language out of a registry that can
// now run into the dozens (see language-registry.ts's own doc comment on
// why it's no longer capped at eighteen entries) -- a flat native <select>
// stops being realistically browsable well before that size. Typing
// filters by native name, English label, or BCP-47 code via the
// registry's own filterLanguages(), so "日本語", "Japanese", and "ja" all
// find the same entry. A "(Beta)" suffix is shown only for entries whose
// UI translation is incomplete (uiSupportLevel) -- it says nothing about
// that language's conversation/STT/TTS quality, which are separate,
// independently-tracked dimensions.
export function LanguageCombobox({
  languages,
  value,
  onChange,
  ariaLabel,
  searchPlaceholder,
  noMatchesLabel,
  className,
  leadingOption,
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEntry = languages.find((entry) => entry.code === value);
  const selectedDisplay =
    leadingOption && leadingOption.value === value ? leadingOption.display : (selectedEntry?.nativeName ?? value);

  const filtered = useMemo(() => filterLanguages(languages, query), [languages, query]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function openDropdown() {
    setQuery("");
    setOpen(true);
  }

  function selectCode(code: string) {
    onChange(code);
    setOpen(false);
  }

  return (
    // min-w-0: this sits inside flex rows (Topbar, Consult AI's header)
    // that need it to actually shrink below its caller-given width on a
    // narrow phone, rather than forcing the row wider than the viewport
    // -- the trigger's own truncate below already handles a long
    // selected-language name gracefully once shrinking is allowed to
    // happen at all.
    <div ref={containerRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="truncate">{selectedDisplay}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-64 max-w-[80vw] rounded-xl border border-border bg-surface shadow-lg">
          <div className="p-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && filtered.length > 0) selectCode(filtered[0].code);
              }}
            />
          </div>
          <ul role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto px-1 pb-1">
            {leadingOption ? (
              <li role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === leadingOption.value}
                  onClick={() => selectCode(leadingOption.value)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-alt"
                >
                  {leadingOption.display}
                  {value === leadingOption.value ? (
                    <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            ) : null}
            {filtered.map((entry) => (
              <li key={entry.code} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === entry.code}
                  dir={entry.direction}
                  onClick={() => selectCode(entry.code)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-alt"
                >
                  <span className="truncate">
                    {entry.nativeName}
                    <span className="text-muted">
                      {" "}
                      ({entry.label}
                      {entry.uiSupportLevel === "beta" ? " · Beta" : ""})
                    </span>
                  </span>
                  {value === entry.code ? (
                    <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? <li className="px-2 py-1.5 text-sm text-muted">{noMatchesLabel}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
