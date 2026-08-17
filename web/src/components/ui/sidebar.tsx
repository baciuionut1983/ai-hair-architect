"use client";

import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { cn } from "./cn";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  status?: "available" | "coming-soon";
}

const SIDEBAR_ITEM_BASE_CLASSES =
  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function getSidebarItemClasses(isActive: boolean, className?: string): string {
  return cn(
    SIDEBAR_ITEM_BASE_CLASSES,
    isActive ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-alt hover:text-foreground",
    className
  );
}

// Exported (not just used inline below) so the safe-area fix itself is
// independently testable without a rendering environment: on the mobile
// drawer, this keeps the last nav item from landing flush against, or
// under, iPhone's home-indicator area. A no-op on desktop/non-notched
// devices, where env(safe-area-inset-bottom) resolves to 0.
export function getSidebarNavClasses(): string {
  return "flex flex-col gap-1 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]";
}

export interface SidebarProps {
  items: SidebarNavItem[];
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ items, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!mobileOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onMobileClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onMobileClose]);

  const nav = (
    <nav className={getSidebarNavClasses()} aria-label="Main navigation">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={getSidebarItemClasses(isActive)}
            onClick={onMobileClose}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {item.status === "coming-soon" ? (
              <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-muted">Soon</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">
        <div className="px-4 py-5">
          <p className="text-sm font-semibold text-foreground">AI Hair Architect</p>
        </div>
        {nav}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} aria-hidden="true" />
          <aside className="relative z-50 flex w-64 flex-col bg-surface">
            <div className="flex items-center justify-between px-4 py-5">
              <p className="text-sm font-semibold text-foreground">AI Hair Architect</p>
              <button
                type="button"
                onClick={onMobileClose}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
