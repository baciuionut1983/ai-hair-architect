"use client";

// AI Concierge / Orchestrator -- Production Fix #2 (cross-navigation
// conversational continuity).
//
// ROOT CAUSE (proven from the current codebase, not assumed -- see this
// fix's own report): ConciergePanel is rendered ONLY inside DashboardPage's
// own component tree ((app)/dashboard/page.tsx), never in the persistent
// (app)/layout.tsx shell. Next.js's App Router unmounts a route's page
// component (and everything inside it) on navigation to a different route,
// remounting a brand new tree when the user navigates back.
// useConcierge's own ConciergeWorkflowMemory previously lived in a plain
// useState INSIDE that hook -- correct for a single page's lifetime, but
// destroyed and recreated blank on every Dashboard remount.
//
// FIX: lift the SAME memory shape (concierge-workflow-memory-logic.ts's own
// ConciergeWorkflowMemory -- completely unchanged) one level up, into a
// Context Provider mounted in (app)/layout.tsx -- the ALREADY-ESTABLISHED
// pattern this codebase uses for exactly this kind of "survive internal
// navigation, reset on a fresh load" state (see ui-language-context.tsx's
// own UiLanguageProvider, mounted in the identical spot, including this
// same "no test file -- thin React glue, the real logic underneath is
// fully tested" convention). Nothing about HOW memory is produced,
// consumed, or (most importantly) re-validated changes: updateWorkflowMemory
// and resolveEffectiveContext (concierge-workflow-memory-logic.ts) are
// UNCHANGED pure functions; the server-side re-verification every decision
// already goes through (orchestrator-service.ts's own
// findClientForOwner/findAnalysisForOwner calls, untouched) is exactly what
// makes "DB current state always wins over remembered context" true --
// this fix only changes WHERE the React state that feeds those existing
// functions happens to live.
//
// WHY a Context Provider and not sessionStorage: this codebase's ONLY
// existing precedent for browser-storage persistence
// (consultation-chat.tsx's own LANGUAGE_SELECTION_STORAGE_KEY) is a simple,
// low-risk UI preference -- there is no existing precedent for serializing
// rich conversational state to a string a user's own devtools could edit.
// A Context Provider mounted in the persistent layout gives EXACTLY the
// required behavior with zero new attack surface: normal internal
// navigation (Dashboard -> client page -> Dashboard) preserves it, because
// (app)/layout.tsx's own tree never unmounts for that navigation; a hard
// refresh or a new tab naturally resets it to blank, because the WHOLE
// React app (including this provider) is freshly created either way --
// exactly the property concierge-workflow-memory-logic.ts's own original
// header comment already required ("a page reload/browser restart...
// invalidate[s] remembered context," "one tab's context [never leaks] into
// another"), now true one level higher without any new code needed to
// enforce it. Logout/login-as-another-account is the same story: /login
// lives OUTSIDE the (app) route group (see (app)/layout.tsx), so logging
// out unmounts this provider along with the rest of the authenticated
// shell, and logging back in (as the same or a different account) mounts a
// completely fresh one.
//
// Deliberately NOT persisted here, and never will be through this
// mechanism (in-memory only, never serialized): ConciergePendingDecision,
// professional approval, cost/consent state, provider state, secrets --
// none of that lives in ConciergeWorkflowMemory today either (it already
// only ever holds ids + a plan goal/step id, all re-verified server-side
// every turn), so this fix introduces no new persisted authority surface
// at all.

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { INITIAL_WORKFLOW_MEMORY, type ConciergeWorkflowMemory } from "./concierge-workflow-memory-logic";

export interface ConciergeWorkflowMemoryContextValue {
  memory: ConciergeWorkflowMemory;
  setMemory: (next: ConciergeWorkflowMemory) => void;
}

const ConciergeWorkflowMemoryContext = createContext<ConciergeWorkflowMemoryContextValue | null>(null);

export function ConciergeWorkflowMemoryProvider({ children }: { children: ReactNode }) {
  const [memory, setMemory] = useState<ConciergeWorkflowMemory>(INITIAL_WORKFLOW_MEMORY);
  const value = useMemo<ConciergeWorkflowMemoryContextValue>(() => ({ memory, setMemory }), [memory]);
  return <ConciergeWorkflowMemoryContext.Provider value={value}>{children}</ConciergeWorkflowMemoryContext.Provider>;
}

// Deliberately no context value is required to render (same precedent as
// useUiLanguage) -- a ConciergePanel rendered outside the provider (a
// future standalone embed, or a unit test) still works, falling back to
// its own local, page-lifetime-only memory instead of crashing. Both hooks
// below are called unconditionally, every render (never inside the `if`),
// so this stays rules-of-hooks-safe regardless of which branch is taken.
export function useConciergeWorkflowMemoryContext(): ConciergeWorkflowMemoryContextValue {
  const context = useContext(ConciergeWorkflowMemoryContext);
  const [localMemory, setLocalMemory] = useState<ConciergeWorkflowMemory>(INITIAL_WORKFLOW_MEMORY);
  if (context) return context;
  return { memory: localMemory, setMemory: setLocalMemory };
}
