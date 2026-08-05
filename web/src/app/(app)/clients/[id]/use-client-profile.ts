import { useEffect, useState } from "react";

import type { ClientRecord } from "@/lib/contracts";

export type ClientProfileState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; client: ClientRecord };

// M31 GO-3: extracted from clients/[id]/page.tsx (its exact previous
// inline fetch effect, unchanged behavior) so the new analysis wizard page
// can resolve+display the same client without re-fetching the same
// GET /api/v1/clients/[id] logic a second time.
export function useClientProfile(clientId: string): ClientProfileState {
  const [state, setState] = useState<ClientProfileState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}`, { method: "GET" });
        if (cancelled) return;

        if (response.status === 404) {
          setState({ status: "not-found" });
          return;
        }

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as { client: ClientRecord };
        setState({ status: "ready", client: payload.client });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return state;
}
