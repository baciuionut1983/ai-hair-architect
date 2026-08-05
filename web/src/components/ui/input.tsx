import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

const INPUT_BASE_CLASSES =
  "w-full rounded-xl border bg-surface-alt px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";

export function getInputClasses(hasError: boolean, className?: string): string {
  return cn(INPUT_BASE_CLASSES, hasError ? "border-danger" : "border-border", className);
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm text-muted">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={getInputClasses(Boolean(error), className)}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
});

Input.displayName = "Input";
