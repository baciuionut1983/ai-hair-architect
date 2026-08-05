"use client";

import { LogOut, Menu } from "lucide-react";

import { cn } from "./cn";

export const TOPBAR_BASE_CLASSES =
  "flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 md:px-6";

export interface TopbarProps {
  userEmail?: string;
  onLogout: () => void;
  onMenuToggle: () => void;
  className?: string;
}

export function Topbar({ userEmail, onLogout, onMenuToggle, className }: TopbarProps) {
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
      <button
        type="button"
        onClick={onLogout}
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Log out
      </button>
    </header>
  );
}
