"use client";

import { useEffect, useState } from "react";

import type { OrchestratorDecision } from "@/lib/orchestrator-contracts";
import { buildVideoOfferCheckRequestBody, interpretVideoOfferDecision } from "./concierge-video-offer-logic";

// AI Concierge / Orchestrator, Stage 2 -- the video-offer data hook.
// Mirrors dashboard/page.tsx's own established one-shot mount-fetch
// pattern (plain fetch + useState + a `cancelled` guard in cleanup) --
// this is a SINGLE read-only check, never polling, never repeated.
//
// This hook makes exactly ONE real HTTP request, to the EXISTING
// /api/v1/concierge/orchestrate route -- never Video's own create/execute
// endpoints, never Google/Veo (see route.ts's own header comment: that
// route itself is incapable of reaching an engine).
export type ConciergeVideoOfferState =
  | { status: "checking" }
  | { status: "offered" }
  // Task section 5: accepting/declining only ever changes THIS hook's own
  // local state -- nothing is persisted. A remount (a genuinely new page
  // view) checks again from scratch; within the SAME mount, "offered" can
  // never be reached again after "accepted"/"declined" (task section 13
  // test J).
  | { status: "accepted" }
  | { status: "declined" }
  | { status: "not_offered" }
  | { status: "error" };

export function useConciergeVideoOffer(clientId: string, analysisId: string) {
  const [state, setState] = useState<ConciergeVideoOfferState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await fetch("/api/v1/concierge/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildVideoOfferCheckRequestBody(clientId, analysisId)),
        });
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const payload = (await response.json()) as { decision: OrchestratorDecision };
        if (cancelled) return;
        setState(interpretVideoOfferDecision(payload.decision) === "offered" ? { status: "offered" } : { status: "not_offered" });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [clientId, analysisId]);

  function accept() {
    setState((previous) => {
      if (previous.status !== "offered") return previous;
      logVideoOfferInteraction("video_offer_accepted");
      return { status: "accepted" };
    });
  }

  function decline() {
    setState((previous) => {
      if (previous.status !== "offered") return previous;
      // Task section 5: "an orchestration observability event MAY record
      // that the offer was declined, but do not store unnecessary
      // conversational data" -- this is a console-only, unpersisted signal
      // (mirrors this app's own established convention of console-only
      // gate lines for events with no real mutation to hang off of),
      // never a new DB row, never the message text (there is none here).
      logVideoOfferInteraction("video_offer_declined");
      return { status: "declined" };
    });
  }

  return { state, accept, decline };
}

// Task section 11: distinguishable from the server-side
// "video_offer_presented" (orchestrator-service.ts's own
// CONCIERGE_ORCHESTRATION line) -- these two purely client-side
// interaction events have no server mutation to record, so they are
// logged here, client-side, console-only, never transmitted or persisted.
function logVideoOfferInteraction(event: "video_offer_accepted" | "video_offer_declined"): void {
  // eslint-disable-next-line no-console -- deliberate, matches this app's
  // own established client-side dev-visibility convention (VOICE_REPLY_CLIENT
  // logging); never sent to a server, never persisted.
  console.log(JSON.stringify({ gate: "CONCIERGE_ORCHESTRATION", event }));
}
