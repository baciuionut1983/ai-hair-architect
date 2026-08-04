import { describe, expect, it } from "vitest";

import { POST } from "./route";

function invoke(body: unknown, ip: string): Promise<Response> {
  const request = new Request("http://localhost/api/v1/analysis/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request);
}

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

describe("POST /api/v1/analysis/preview", () => {
  it("requires no authentication at all (no cookie, no Bearer token, no session mock)", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );
    expect(response.status).toBe(200);
  });

  it("returns an honest preview: recommendations, safety notes, follow-up questions, disclaimer, preview: true", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(Array.isArray(body.safetyNotes)).toBe(true);
    expect(Array.isArray(body.followUpQuestions)).toBe(true);
    expect(typeof body.disclaimer).toBe("string");
    expect(body.disclaimer.length).toBeGreaterThan(0);
  });

  it("never includes a fabricated confidence score", async () => {
    const response = await invoke(
      { goal: "lighten", hairType: "fine", density: "low", porosity: "high" },
      freshIp()
    );
    const body = await response.json();
    expect(body).not.toHaveProperty("confidenceScore");
  });

  it("never includes an analysisId, phase, or clarificationRound (nothing persisted, no implied async workflow)", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );
    const body = await response.json();
    expect(body).not.toHaveProperty("analysisId");
    expect(body).not.toHaveProperty("phase");
    expect(body).not.toHaveProperty("clarificationRound");
  });

  it("never leaks a professional technicalCutPlan, even when goal alone (reshape) would trigger one in the engine", async () => {
    const response = await invoke(
      { goal: "reshape", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("technicalCutPlan");
  });

  it("ignores any advanced professional field smuggled into the request body", async () => {
    const response = await invoke(
      {
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        faceShape: "oval",
        headShape: "balanced",
        clientId: "someone-elses-client",
      },
      freshIp()
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("technicalCutPlan");
    expect(body).not.toHaveProperty("clientId");
  });

  it("calls the real deterministic engine: different inputs produce different recommendations, proving this is not a canned response", async () => {
    const first = await invoke(
      { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );
    const second = await invoke(
      { goal: "reshape", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );

    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.recommendations).not.toEqual(secondBody.recommendations);
  });

  it("returns 400 when goal is missing", async () => {
    const response = await invoke({ hairType: "medium", density: "medium", porosity: "medium" }, freshIp());
    expect(response.status).toBe(400);
  });

  it("returns 400 when goal is not a valid enum value", async () => {
    const response = await invoke(
      { goal: "not-a-real-goal", hairType: "medium", density: "medium", porosity: "medium" },
      freshIp()
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when hairType is invalid", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "silky", density: "medium", porosity: "medium" },
      freshIp()
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when density is invalid", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "medium", density: "very-high", porosity: "medium" },
      freshIp()
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when porosity is invalid", async () => {
    const response = await invoke(
      { goal: "refresh", hairType: "medium", density: "medium", porosity: "extreme" },
      freshIp()
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for malformed JSON body", async () => {
    const response = await invoke("not json {{{", freshIp());
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    const response = await invoke({}, freshIp());
    expect(response.status).toBe(400);
  });
});

describe("POST /api/v1/analysis/preview -- rate limiting", () => {
  it("allows up to the per-IP limit and rejects the next request with 429", async () => {
    const ip = freshIp();
    const payload = { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" };

    for (let i = 0; i < 20; i += 1) {
      const response = await invoke(payload, ip);
      expect(response.status).toBe(200);
    }

    const rejected = await invoke(payload, ip);
    expect(rejected.status).toBe(429);
    const body = await rejected.json();
    expect(body).toEqual({ error: "Rate limit exceeded." });
  });

  it("rate-limits per IP independently: a different IP is unaffected by another IP's limit", async () => {
    const busyIp = freshIp();
    const otherIp = freshIp();
    const payload = { goal: "refresh", hairType: "medium", density: "medium", porosity: "medium" };

    for (let i = 0; i < 20; i += 1) {
      await invoke(payload, busyIp);
    }
    await invoke(payload, busyIp); // consumes the 21st, now limited

    const response = await invoke(payload, otherIp);
    expect(response.status).toBe(200);
  });
});
