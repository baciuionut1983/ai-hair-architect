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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuToggle}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        {userEmail ? <p className="text-sm text-muted">{userEmail}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {rightSlot}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {logoutLabel}
        </button>
      </div>
    </header>
  );
}
