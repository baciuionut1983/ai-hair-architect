import { NextResponse } from "next/server";

import { getSubscriptionByOwner, type BillingSubscriptionRow } from "@/lib/billing-repository";
import { authenticateBillingSessionOwner } from "@/lib/billing-session-auth";
import type { SubscriptionPlan, SubscriptionRecord, SubscriptionStatus } from "@/lib/contracts";

// Allowlist, not a denylist: only active and trialing (existing product policy,
// see milestone1-store's getAnalyticsSnapshotForUser) ever carry paid entitlement.
// Every other known status (past_due, canceled, unpaid, paused, incomplete,
// incomplete_expired) -- and any future status this code does not yet know about --
// falls closed to entitlementActive: false. The real plan/status are still
// surfaced for UI/informational purposes; entitlementActive is the single,
// unambiguous field callers must check to decide paid access. No caller may
// infer access from plan alone.
const ENTITLED_STATUSES = new Set(["active", "trialing"]);
const KNOWN_PLANS = new Set(["pro", "salon", "business"]);

export interface SubscriptionResponsePayload extends SubscriptionRecord {
  entitlementActive: boolean;
}

export async function GET(request: Request) {
  try {
    const owner = await authenticateBillingSessionOwner(request);
    if (!owner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await getSubscriptionByOwner(owner.id, "stripe");
    return NextResponse.json({ subscription: toSubscriptionRecord(owner.id, row) }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "BILLING_SUBSCRIPTION_INTERNAL_ERROR" }, { status: 500 });
  }
}

function toSubscriptionRecord(ownerUserId: string, row: BillingSubscriptionRow | null): SubscriptionResponsePayload {
  if (!row || !KNOWN_PLANS.has(row.planKey)) {
    return freeSubscriptionRecord(ownerUserId);
  }
  return {
    id: row.id,
    ownerUserId,
    plan: row.planKey as SubscriptionPlan,
    status: row.status as SubscriptionStatus,
    entitlementActive: ENTITLED_STATUSES.has(row.status),
    currentPeriodEnd: (row.currentPeriodEnd ?? new Date()).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function freeSubscriptionRecord(ownerUserId: string): SubscriptionResponsePayload {
  const now = new Date().toISOString();
  return {
    id: `free-${ownerUserId}`,
    ownerUserId,
    plan: "free",
    status: "inactive",
    entitlementActive: false,
    currentPeriodEnd: now,
    updatedAt: now,
  };
}
