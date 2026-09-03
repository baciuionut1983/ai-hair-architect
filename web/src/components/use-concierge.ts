"use client";

import { useCallback, useState } from "react";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
import type { OrchestrationPlan } from "@/lib/orchestrator-plan-contracts";
import { buildOrchestrateRequestBody } from "./concierge-logic";
import { useConciergeWorkflowMemoryContext } from "./concierge-workflow-memory-context";
import {
  resolveEffectiveContext,
  updateWorkflowMemory,
  type ConciergePageContext,
} from "./concierge-workflow-memory-logic";

// AI Concierge / Orchestrator, Stage 1 -- the data-fetching hook. Plain
// fetch + useState, mirroring use-video-demonstration.ts's own style, but
// genuinely simpler: one request produces one decision, no in-flight job
// to poll -- there is nothing here that can ever call Video/Photo Preview's
// own create/execute endpoints (see orchestrator-action-registry.ts's own
// header comment: every action is navigation-only).
//
// Stage 4: also owns this session's remembered ConciergeWorkflowMemory
// (concierge-workflow-memory-logic.ts) -- purely in-memory React state,
// see that file's own header comment for exactly why. Every request this
// hook sends is built from resolveEffectiveContext (the caller's own real
// page context, when supplied, always wins over remembered memory), and
// every response updates that memory in one atomic recompute, never a
// merge with anything older.
//
// Production Fix #2: the memory itself is no longer a LOCAL useState here
// -- it is sourced from useConciergeWorkflowMemoryContext (a Provider
// mounted in (app)/layout.tsx, which does not unmount on ordinary internal
// navigation, unlike this hook's own caller). This is the ONLY change:
// every read/update of memory below is identical to before, just backed by
// state that now survives Dashboard -> client page -> Dashboard instead of
// being destroyed on unmount. See concierge-workflow-memory-context.tsx's
// own header comment for the full root-cause/architecture writeup.
//
// Stage 5: `plan` (additive, may be null) is carried alongside `decision`
// exactly the same way -- nothing here ever acts on the plan itself
// (there is no "auto-run the whole plan" code path anywhere in this
// hook); it is surfaced purely for a caller that wants to render richer
// progress than the single recommendedAction already drives.
//
// Voice input integration: also returns `activeClientId` -- the SAME
// resolveEffectiveContext computation `ask` already runs internally on
// every call, exposed here purely so a caller can decide UI eligibility
// (e.g. concierge-voice-input.tsx only mounts the existing, closed
// useVoiceRecording hook once a real client id is available -- see that
// file's own header comment for why). This is read-only, derived data --
// never a second source of truth, never itself sent anywhere.

export type ConciergeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; decision: OrchestratorDecision; plan: OrchestrationPlan | null };

export type UseConciergeContext = ConciergePageContext;

export function useConcierge(context: UseConciergeContext = {}) {
  const [state, setState] = useState<ConciergeState>({ status: "idle" });
  const { memory, setMemory } = useConciergeWorkflowMemoryContext();

  const ask = useCallback(
    async (rawMessage: string) => {
      const effectiveContext = resolveEffectiveContext(context, memory);
      // AI Concierge Gap #3: echoes the remembered "already offered for
      // this preview" hint under the request body's own field name --
      // presentation suppression only, see concierge-workflow-memory-logic.ts's
      // own header comment on ConciergeEffectiveContext.offeredVideoForPhotoPreviewId.
      const body = buildOrchestrateRequestBody(rawMessage, {
        ...effectiveContext,
        suppressVideoOfferForPhotoPreviewId: effectiveContext.offeredVideoForPhotoPreviewId,
      });
      if (!body) return;

      setState({ status: "loading" });
      try {
        const response = await fetch("/api/v1/concierge/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const payload = (await response.json()) as { decision: OrchestratorDecision; plan: OrchestrationPlan | null };
        setState({ status: "ready", decision: payload.decision, plan: payload.plan });

        const { memory: nextMemory, events } = updateWorkflowMemory(memory, payload.decision, payload.plan);
        setMemory(nextMemory);
        // task section 16 (Stage 4) / task section 17 (Stage 5):
        // client-side-only, matching this codebase's own established
        // VOICE_REPLY_CLIENT/CONCIERGE_ORCHESTRATION client-side logging
        // convention (e.g. use-concierge-video-offer.ts) -- these events
        // genuinely need cross-turn memory the server itself never has
        // (see concierge-workflow-memory-logic.ts's own header comment on
        // every other required event, which IS logged server-side).
        for (const event of events) {
          console.log(JSON.stringify({ gate: "CONCIERGE_ORCHESTRATION", event }));
        }
      } catch {
        setState({ status: "error" });
      }
    },
    [context, memory, setMemory],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const activeClientId = resolveEffectiveContext(context, memory).currentClientId;

  return { state, ask, reset, pendingDecision: memory.pendingDecision, activePlanGoal: memory.activePlanGoal, activeClientId };
}
