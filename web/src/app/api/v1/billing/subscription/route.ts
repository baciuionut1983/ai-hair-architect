import { NextResponse } from "next/server";

import { ENTITLED_SUBSCRIPTION_STATUSES, getSubscriptionByOwner, type BillingSubscriptionRow } from "@/lib/billing-repository";
import type { SubscriptionPlan, SubscriptionRecord, SubscriptionStatus } from "@/lib/contracts";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

const KNOWN_PLANS = new Set(["pro", "salon", "business"]);

export interface SubscriptionResponsePayload extends SubscriptionRecord {
  entitlementActive: boolean;
}

export async function GET() {
  try {
    const owner = await authenticateSessionRequest();
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
    entitlementActive: ENTITLED_SUBSCRIPTION_STATUSES.has(row.status),
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
