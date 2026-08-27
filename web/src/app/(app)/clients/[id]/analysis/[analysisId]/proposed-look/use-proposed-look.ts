import { useCallback, useEffect, useState } from "react";

import type { ProposalEditEntry } from "@/lib/proposal-validators";
import type { ProposalRecord } from "@/lib/proposal-repository";

import { mapProposedLookApiError, resolveProposedLookLoadStatus } from "./proposed-look-logic";

// AI Proposed Look (Phase 2), Stage 4a -- the data-fetching/action hook.
// Mirrors use-analysis-result.ts's plain fetch+useState+useEffect style
// exactly (no SWR/React Query -- none is used anywhere in this codebase).
// Vertical is hardcoded to "cutting" everywhere: Phase 2 supports no other
// vertical, so this hook takes no vertical parameter.

export type ProposedLookState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; current: ProposalRecord | null; history: ProposalRecord[] };

export interface ProposedLookActionSuccess {
  ok: true;
  proposal: ProposalRecord;
}

export interface ProposedLookActionFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

export type ProposedLookActionOutcome = ProposedLookActionSuccess | ProposedLookActionFailure;

export interface UseProposedLookResult {
  state: ProposedLookState;
  reload: () => void;
  createDraft: (analysisId: string) => Promise<ProposedLookActionOutcome>;
  editDraft: (proposalId: string, edits: ProposalEditEntry[]) => Promise<ProposedLookActionOutcome>;
  confirmDraft: (proposalId: string, expectedCurrentConfirmedProposalId: string | null) => Promise<ProposedLookActionOutcome>;
  rejectDraft: (proposalId: string) => Promise<ProposedLookActionOutcome>;
}

interface ParsedErrorBody {
  error?: string;
  message?: string;
}

async function toActionOutcome(response: Response): Promise<ProposedLookActionOutcome> {
  if (response.ok) {
    const body = (await response.json()) as { proposal: ProposalRecord };
    return { ok: true, proposal: body.proposal };
  }

  let body: ParsedErrorBody = {};
  try {
    body = (await response.json()) as ParsedErrorBody;
  } catch {
    // best-effort -- an empty/non-JSON error body still maps to a safe message below.
  }

  return {
    ok: false,
    status: response.status,
    code: body.error,
    message: mapProposedLookApiError(response.status, body.error),
  };
}

export function useProposedLook(clientId: string): UseProposedLookResult {
  const [state, setState] = useState<ProposedLookState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [currentResponse, listResponse] = await Promise.all([
          fetch(`/api/v1/clients/${clientId}/analysis-proposals/current?vertical=cutting`, { method: "GET" }),
          fetch(`/api/v1/clients/${clientId}/analysis-proposals?vertical=cutting`, { method: "GET" }),
        ]);
        if (cancelled) return;

        if (
          resolveProposedLookLoadStatus(currentResponse) !== "ready" ||
          resolveProposedLookLoadStatus(listResponse) !== "ready"
        ) {
          setState({ status: "error" });
          return;
        }

        const currentBody = (await currentResponse.json()) as { proposal: ProposalRecord | null };
        const listBody = (await listResponse.json()) as { proposals: ProposalRecord[] };
        if (cancelled) return;

        setState({ status: "ready", current: currentBody.proposal, history: listBody.proposals });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const createDraft = useCallback(
    async (analysisId: string): Promise<ProposedLookActionOutcome> => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/analysis-proposals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysisId, vertical: "cutting" }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapProposedLookApiError(0) };
      }
    },
    [clientId, reload],
  );

  const editDraft = useCallback(
    async (proposalId: string, edits: ProposalEditEntry[]): Promise<ProposedLookActionOutcome> => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/analysis-proposals/${proposalId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapProposedLookApiError(0) };
      }
    },
    [clientId, reload],
  );

  const confirmDraft = useCallback(
    async (proposalId: string, expectedCurrentConfirmedProposalId: string | null): Promise<ProposedLookActionOutcome> => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentConfirmedProposalId }),
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapProposedLookApiError(0) };
      }
    },
    [clientId, reload],
  );

  const rejectDraft = useCallback(
    async (proposalId: string): Promise<ProposedLookActionOutcome> => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/analysis-proposals/${proposalId}/reject`, {
          method: "POST",
        });
        const outcome = await toActionOutcome(response);
        reload();
        return outcome;
      } catch {
        reload();
        return { ok: false, status: 0, message: mapProposedLookApiError(0) };
      }
    },
    [clientId, reload],
  );

  return { state, reload, createDraft, editDraft, confirmDraft, rejectDraft };
}
