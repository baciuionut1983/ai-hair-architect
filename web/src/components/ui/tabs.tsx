"use client";

import { cn } from "./cn";

export interface TabItem {
  value: string;
  label: string;
}

// Regression (mobile audit): this row previously had no wrap AND no
// scroll containment -- with 5 tabs (Overview/History/Appointments/AI
// Analysis/Consult AI) on a narrow phone, the row's content was simply
// wider than the viewport, and since nothing in the ancestor chain
// clips overflow-x, that forced the WHOLE PAGE to scroll horizontally,
// not just the tab bar. overflow-x-auto contains the scroll to this one
// row (controlled horizontal scroll, chosen over wrapping -- wrapping a
// row of underlined tab triggers looks broken, a scrollable strip is
// the standard mobile tab-bar pattern); shrink-0 on each trigger stops
// the browser from instead trying to squeeze tab labels illegibly thin.
const TABS_LIST_BASE_CLASSES = "flex gap-1 overflow-x-auto border-b border-border";

const TAB_TRIGGER_BASE_CLASSES =
  "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// Exported (not just used inline in Tabs below) so the mobile-scroll fix
// itself is independently testable without a rendering environment (no
// .test.tsx convention exists in this repo).
export function getTabsListClasses(className?: string): string {
  return cn(TABS_LIST_BASE_CLASSES, className);
}

export function getTabTriggerClasses(isActive: boolean, className?: string): string {
  return cn(
    TAB_TRIGGER_BASE_CLASSES,
    isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
    className
  );
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={getTabsListClasses(className)}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={getTabTriggerClasses(isActive)}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
