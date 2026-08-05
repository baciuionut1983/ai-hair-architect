"use client";

import { cn } from "./cn";

export interface TabItem {
  value: string;
  label: string;
}

const TABS_LIST_BASE_CLASSES = "flex gap-1 border-b border-border";

const TAB_TRIGGER_BASE_CLASSES =
  "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
    <div role="tablist" className={cn(TABS_LIST_BASE_CLASSES, className)}>
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
