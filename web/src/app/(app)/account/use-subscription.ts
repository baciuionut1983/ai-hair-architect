import { useCallback, useEffect, useState } from "react";

import type { SubscriptionRecord } from "@/lib/contracts";

export interface SubscriptionSnapshot extends SubscriptionRecord {
  entitlementActive: boolean;
}

export type SubscriptionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; subscription: SubscriptionSnapshot };

/**
 * Always reads the real, persisted billing state from
 * GET /api/v1/billing/subscription -- entitlementActive here is the only
 * source of truth this page ever trusts. A ?checkout=success query param
 * on the page URL is never treated as proof of payment; it only triggers
 * an extra refresh (see refresh()) so a webhook that already landed is
 * reflected without a full page reload.
 */
export function useSubscription(): { state: SubscriptionState; refresh: () => void } {
  const [state, setState] = useState<SubscriptionState>({ status: "loading" });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/v1/billing/subscription", { method: "GET" });
        if (cancelled) return;

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as { subscription: SubscriptionSnapshot };
        setState({ status: "ready", subscription: payload.subscription });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return { state, refresh };
}
