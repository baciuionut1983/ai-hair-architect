import { afterEach, describe, expect, it } from "vitest";

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("billing webhook production policy", () => {
  it("blocks endpoint unconditionally in production", async () => {
    mutableEnv.NODE_ENV = "production";

    const request = new Request("http://localhost/api/v1/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "evt-1" })
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "PRODUCTION_POLICY_BILLING_WEBHOOK_DISABLED"
    });
  });

  it("preserves existing non-production behavior", async () => {
    mutableEnv.NODE_ENV = "test";

    const request = new Request("http://localhost/api/v1/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid webhook payload."
    });
  });
});
