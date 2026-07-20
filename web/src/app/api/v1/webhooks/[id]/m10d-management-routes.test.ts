import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  webhookEndpoint: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/middleware/analytics-auth", () => ({
  validateAnalyticsAccess: vi.fn(),
  createAuthErrorResponse: vi.fn(),
  AnalyticsAuthError: class AnalyticsAuthError extends Error {},
}));

vi.mock("@/lib/webhook-secret-rotation", () => ({
  rotateWebhookSecret: vi.fn(),
}));

vi.mock("@/lib/webhook-delivery-history", () => ({
  listWebhookDeliveryHistoryCursor: vi.fn(),
  getWebhookDeliveryDetails: vi.fn(),
}));

vi.mock("@/lib/webhook-operational-snapshot", () => ({
  getWebhookOperationalSnapshot: vi.fn(),
}));

import { GET as EVENTS_GET } from "./events/route";
import { GET as EVENT_DETAIL_GET } from "./events/[eventId]/route";
import { GET as SNAPSHOT_GET } from "./operational-snapshot/route";
import { POST as ROTATE_POST } from "./regenerate-secret/route";
import { prisma } from "@/lib/prisma";
import { validateAnalyticsAccess } from "@/middleware/analytics-auth";
import { rotateWebhookSecret } from "@/lib/webhook-secret-rotation";
import { listWebhookDeliveryHistoryCursor, getWebhookDeliveryDetails } from "@/lib/webhook-delivery-history";
import { getWebhookOperationalSnapshot } from "@/lib/webhook-operational-snapshot";

describe("M10D management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAnalyticsAccess).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue({
      id: "webhook-1",
      ownerUserId: "user-1",
      enabled: true,
      url: "https://example.com/webhook",
      secretEncrypted: "v1:encrypted",
    } as never);
  });

  it("returns secret regeneration with no-store caching", async () => {
    vi.mocked(rotateWebhookSecret).mockResolvedValue({
      webhookEndpointId: "webhook-1",
      secretVersionId: "secret-version-2",
      secretVersion: 2,
      rotatedAt: new Date("2026-07-20T12:00:00.000Z"),
      retiredPreviousVersionAt: new Date("2026-07-20T12:00:00.000Z"),
      previousVersionRetainUntil: new Date("2026-08-19T12:00:00.000Z"),
      plainSecret: "PLAINTEXT-SECRET",
    });

    const response = await ROTATE_POST({ headers: new Headers({ Authorization: "Bearer token" }) } as never, {
      params: Promise.resolve({ id: "webhook-1" }),
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      webhookEndpointId: "webhook-1",
      plainSecret: "PLAINTEXT-SECRET",
    });
  });

  it("returns cursor-based history pages", async () => {
    vi.mocked(listWebhookDeliveryHistoryCursor).mockResolvedValue({
      data: [
        { id: "delivery-2", attempts: [] },
        { id: "delivery-1", attempts: [] },
      ] as never,
      pageInfo: {
        nextCursor: "delivery-1",
        hasNextPage: true,
        limit: 2,
      },
    });

    const response = await EVENTS_GET(
      {
        url: "http://localhost/api/v1/webhooks/webhook-1/events?limit=2&cursor=delivery-3",
        headers: new Headers({ Authorization: "Bearer token" }),
      } as never,
      { params: Promise.resolve({ id: "webhook-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: "delivery-2" }, { id: "delivery-1" }],
      pageInfo: {
        nextCursor: "delivery-1",
        hasNextPage: true,
        limit: 2,
      },
    });
  });

  it("returns delivery detail for the requested event id", async () => {
    vi.mocked(getWebhookDeliveryDetails).mockResolvedValue({
      id: "delivery-1",
      attempts: [{ attemptNumber: 1 }],
      event: { id: "event-1" },
    } as never);

    const response = await EVENT_DETAIL_GET(
      {
        url: "http://localhost/api/v1/webhooks/webhook-1/events/delivery-1",
        headers: new Headers({ Authorization: "Bearer token" }),
      } as never,
      { params: Promise.resolve({ id: "webhook-1", eventId: "delivery-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "delivery-1",
      event: { id: "event-1" },
    });
  });

  it("returns an operational snapshot from the stable service", async () => {
    vi.mocked(getWebhookOperationalSnapshot).mockResolvedValue({
      pendingDeliveries: 1,
      dispatchingDeliveries: 0,
      deliveredDeliveries: 2,
      retryableDeliveries: 1,
      terminalFailures: 1,
      activeDeliveries: 2,
      successRate: 0.6666667,
      oldestPendingAgeMs: 3600000,
      deliveryLatencyMedianMs: 1000,
      deliveryLatencyP95Ms: 2000,
      createdLast24h: 5,
      deliveredLast24h: 2,
      failedLast24h: 1,
      deliveriesLast24h: 5,
      retryDistribution: { attempt1: 2, attempt2: 1, attempt3: 1, attempt4Plus: 1 },
    });

    const response = await SNAPSHOT_GET(
      {
        url: "http://localhost/api/v1/webhooks/webhook-1/operational-snapshot",
        headers: new Headers({ Authorization: "Bearer token" }),
      } as never,
      { params: Promise.resolve({ id: "webhook-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      pendingDeliveries: 1,
      failedLast24h: 1,
    });
  });

  it("returns 404 for cross-user access", async () => {
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue({
      id: "webhook-1",
      ownerUserId: "other-user",
      enabled: true,
      url: "https://example.com/webhook",
      secretEncrypted: "v1:encrypted",
    } as never);

    const response = await EVENTS_GET(
      {
        url: "http://localhost/api/v1/webhooks/webhook-1/events",
        headers: new Headers({ Authorization: "Bearer token" }),
      } as never,
      { params: Promise.resolve({ id: "webhook-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "NOT_FOUND" });
  });
});