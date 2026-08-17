"use client";

import { LogOut, Menu } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export const TOPBAR_BASE_CLASSES =
  "flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 md:px-6";

export interface TopbarProps {
  userEmail?: string;
  onLogout: () => void;
  onMenuToggle: () => void;
  className?: string;
  // Translated "Log out" label -- defaults to the English literal so
  // every existing call site (and this component's own tests) keeps
  // working unchanged for callers that don't pass one.
  logoutLabel?: string;
  // Rendered immediately before the logout button -- the global language
  // selector's own slot (see (app)/layout.tsx), kept generic here so
  // Topbar itself has no language-registry knowledge of its own.
  rightSlot?: ReactNode;
}

export function Topbar({ userEmail, onLogout, onMenuToggle, className, logoutLabel = "Log out", rightSlot }: TopbarProps) {
  return (
    <header className={cn(TOPBAR_BASE_CLASSES, className)}>
      {/* min-w-0 on both sides + the email itself: without it, a flex
          item's default min-width is "auto" (its content's natural
          size), not 0 -- so on a narrow phone, an untruncated email plus
          a fixed-width language selector plus the logout button could
          together be wider than the viewport, with nothing able to
          shrink to fit. min-w-0 here, and truncate on the email, let
          this row always fit in one line instead of forcing the page to
          scroll horizontally. */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuToggle}
          className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        {userEmail ? <p className="min-w-0 truncate text-sm text-muted">{userEmail}</p> : null}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {rightSlot}
        <button
          type="button"
          onClick={onLogout}
          className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {logoutLabel}
        </button>
      </div>
    </header>
  );
}
