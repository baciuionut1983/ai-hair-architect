"use client";

import { CircleUserRound } from "lucide-react";
import { useState } from "react";

import { Alert, Badge, Button, Card, ErrorState, LoadingState } from "@/components/ui";

import {
  ACCOUNT_PLANS,
  checkoutErrorMessage,
  planDisplayName,
  resolveAccountPlanCardStatus,
  type AccountPlanCardStatus,
  type AccountPlanDefinition,
  type AccountPlanKey,
} from "./account-plans";
import { useSubscription, type SubscriptionSnapshot } from "./use-subscription";

// Read-only, cosmetic: drives only the transient banner text, never
// entitlement (that always comes from useSubscription's real fetch).
// Computed directly during render (not state+effect) -- typeof window
// guards the server-rendered pass, and re-deriving this on every render is
// cheap and always gives the same answer since the URL doesn't change
// under this component.
function readCheckoutQueryStatus(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("checkout");
}

// Extracted so the external-redirect side effect (leaving the app entirely
// for Stripe's hosted checkout) is a plain, isolated function call from
// inside the event handler, not an inline assignment in the component body.
function navigateToExternalUrl(url: string): void {
  window.location.href = url;
}

export default function AccountPage() {
  const { state, refresh } = useSubscription();
  const checkoutQueryStatus = readCheckoutQueryStatus();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutBusyPlan, setCheckoutBusyPlan] = useState<AccountPlanKey | null>(null);

  async function handleSubscribe(planKey: AccountPlanKey) {
    setCheckoutError(null);
    setCheckoutBusyPlan(planKey);
    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = (await response.json()) as { checkout?: { url?: string }; error?: string };

      if (!response.ok || !data.checkout?.url) {
        setCheckoutError(checkoutErrorMessage(data.error));
        // The server just told us the owner already has an active
        // subscription -- most likely because it was activated in another
        // tab, or the page's initial snapshot was already stale by the
        // time this click landed. Re-fetch so the plan cards immediately
        // reflect reality instead of still offering a Subscribe button.
        if (data.error === "BILLING_CHECKOUT_ALREADY_ACTIVE") {
          refresh();
        }
        return;
      }

      navigateToExternalUrl(data.checkout.url);
    } catch {
      setCheckoutError(checkoutErrorMessage(undefined));
    } finally {
      setCheckoutBusyPlan(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Account & Subscription</h1>

      {checkoutQueryStatus === "success" ? (
        <Alert variant="info">
          Payment received. It can take a moment for your subscription to activate here -- refresh if it doesn&apos;t
          update automatically.
        </Alert>
      ) : null}
      {checkoutQueryStatus === "cancel" ? <Alert variant="warning">Checkout was canceled. No changes were made.</Alert> : null}

      {state.status === "loading" ? <LoadingState label="Loading your subscription..." /> : null}

      {state.status === "error" ? (
        <ErrorState
          title="Couldn't load your subscription"
          description="Please try refreshing the page."
          action={
            <Button type="button" variant="secondary" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : null}

      {state.status === "ready" ? (
        <>
          <CurrentPlanCard subscription={state.subscription} onRefresh={refresh} />

          {checkoutError ? <Alert variant="error">{checkoutError}</Alert> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ACCOUNT_PLANS.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                status={resolveAccountPlanCardStatus(plan.key, state.subscription)}
                busy={checkoutBusyPlan === plan.key}
                onSubscribe={() => handleSubscribe(plan.key)}
              />
            ))}
          </div>

          <ManageSubscriptionCard />
        </>
      ) : null}
    </div>
  );
}

function CurrentPlanCard({
  subscription,
  onRefresh,
}: {
  subscription: SubscriptionSnapshot;
  onRefresh: () => void;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <CircleUserRound className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Current plan</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-foreground">{planDisplayName(subscription.plan)}</span>
        <Badge variant={subscription.entitlementActive ? "success" : "neutral"}>
          {subscription.entitlementActive ? "Active" : "No active subscription"}
        </Badge>
      </div>
      {subscription.entitlementActive ? (
        <p className="text-xs text-muted">
          Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
        </p>
      ) : (
        <p className="text-xs text-muted">Choose a plan below to unlock the full experience.</p>
      )}
      <button type="button" onClick={onRefresh} className="self-start text-xs text-accent hover:underline">
        Refresh
      </button>
    </Card>
  );
}

function PlanCard({
  plan,
  status,
  busy,
  onSubscribe,
}: {
  plan: AccountPlanDefinition;
  status: AccountPlanCardStatus;
  busy: boolean;
  onSubscribe: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{plan.displayName}</h3>
        <p className="text-lg font-semibold text-accent">{plan.priceLabel}</p>
      </div>
      <p className="text-sm text-muted">{plan.description}</p>
      {status === "current" ? (
        <Badge variant="success">Your current plan</Badge>
      ) : status === "blocked-other-active" ? (
        <p className="text-xs text-muted">
          You already have an active subscription. Manage it below before switching plans.
        </p>
      ) : (
        <Button type="button" onClick={onSubscribe} loading={busy}>
          Subscribe
        </Button>
      )}
    </Card>
  );
}

function ManageSubscriptionCard() {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">Manage subscription</h2>
      <p className="text-sm text-muted">
        Self-service subscription management (payment method, cancellation, invoices) is not available yet. Contact
        support if you need to make changes to your subscription.
      </p>
      <Button type="button" variant="secondary" disabled>
        Manage subscription (coming soon)
      </Button>
    </Card>
  );
}
