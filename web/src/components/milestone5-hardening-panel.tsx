"use client";

import { useState } from "react";

import type {
  AgentOrchestrateResponse,
  BillingWebhookEvent,
  SubscriptionRecord,
  SubscriptionStatus
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

type Plan = "free" | "pro" | "salon" | "business";

type TaskType = "analysis" | "consultation" | "marketplace";

export function Milestone5HardeningPanel() {
  const [plan, setPlan] = useState<Plan>("pro");
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [orchestrateTaskType, setOrchestrateTaskType] = useState<TaskType>("consultation");
  const [orchestratePayload, setOrchestratePayload] = useState('{"goal":"refresh","risk":"low"}');
  const [orchestrateResult, setOrchestrateResult] = useState<AgentOrchestrateResponse | null>(null);
  const [lastRequestId, setLastRequestId] = useState("");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadSubscription() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/billing/subscription", { method: "GET" });
      const payload = (await response.json()) as { subscription?: SubscriptionRecord; error?: string };
      if (!response.ok || !payload.subscription) {
        setStatus({ tone: "error", message: payload.error || "Failed to load subscription." });
        return;
      }

      setSubscription(payload.subscription);
      setStatus({ tone: "ok", message: "Subscription loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout() {
    setBusy(true);
    setStatus(null);
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId
        },
        body: JSON.stringify({ plan })
      });

      const payload = (await response.json()) as {
        requestId?: string;
        error?: string;
        subscription?: SubscriptionRecord;
      };

      if (!response.ok || !payload.subscription) {
        setStatus({ tone: "error", message: payload.error || "Checkout failed." });
        return;
      }

      setSubscription(payload.subscription);
      setLastRequestId(payload.requestId || requestId);
      setStatus({ tone: "ok", message: "Checkout started (simulated provider)." });
    } finally {
      setBusy(false);
    }
  }

  async function simulateWebhook(statusValue: SubscriptionStatus) {
    if (!subscription) {
      setStatus({ tone: "error", message: "Load subscription first." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const payload: BillingWebhookEvent = {
        eventId: crypto.randomUUID(),
        userId: subscription.ownerUserId,
        plan: subscription.plan,
        status: statusValue,
        amountCents: statusValue === "active" ? 4900 : 0,
        currency: "USD"
      };

      const response = await fetch("/api/v1/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": crypto.randomUUID()
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as { subscription?: SubscriptionRecord; error?: string };
      if (!response.ok || !body.subscription) {
        setStatus({ tone: "error", message: body.error || "Webhook simulation failed." });
        return;
      }

      setSubscription(body.subscription);
      setStatus({ tone: "ok", message: `Webhook processed: ${statusValue}.` });
    } finally {
      setBusy(false);
    }
  }

  async function runOrchestration() {
    setBusy(true);
    setStatus(null);
    try {
      let parsedPayload: Record<string, unknown>;
      try {
        parsedPayload = JSON.parse(orchestratePayload) as Record<string, unknown>;
      } catch {
        setStatus({ tone: "error", message: "Payload must be valid JSON." });
        return;
      }

      const requestId = crypto.randomUUID();
      const response = await fetch("/api/v1/agents/orchestrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId
        },
        body: JSON.stringify({
          requestId,
          taskType: orchestrateTaskType,
          payload: parsedPayload
        })
      });

      const payload = (await response.json()) as AgentOrchestrateResponse & { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Orchestration failed." });
        return;
      }

      setOrchestrateResult(payload);
      setLastRequestId(payload.requestId);
      setStatus({ tone: "ok", message: "Agent orchestration completed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-next" id="milestone5">
      <div className="section-header-next">
        <h3>Milestone 5 - Billing, AI Agents, Hardening</h3>
        <span>Commercial flow + orchestration + safeguards</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card">
          <h4>1) Billing Checkout + Subscription</h4>
          <div className="field-grid">
            <select value={plan} onChange={(event) => setPlan(event.target.value as Plan)}>
              <option value="free">free</option>
              <option value="pro">pro</option>
              <option value="salon">salon</option>
              <option value="business">business</option>
            </select>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={loadSubscription} disabled={busy}>
              Load subscription
            </button>
            <button type="button" onClick={startCheckout} disabled={busy}>
              Start checkout
            </button>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={() => void simulateWebhook("active")} disabled={busy || !subscription}>
              Simulate webhook active
            </button>
            <button type="button" onClick={() => void simulateWebhook("past_due")} disabled={busy || !subscription}>
              Simulate webhook past_due
            </button>
          </div>

          {subscription ? (
            <div className="analysis-result-box">
              <p><strong>Plan:</strong> {subscription.plan}</p>
              <p><strong>Status:</strong> {subscription.status}</p>
              <p><strong>Period end:</strong> {new Date(subscription.currentPeriodEnd).toLocaleString()}</p>
            </div>
          ) : null}
        </article>

        <article className="milestone-card milestone-card-wide">
          <h4>2) Multi-Agent Orchestration</h4>
          <div className="field-grid field-grid-2">
            <select
              value={orchestrateTaskType}
              onChange={(event) => setOrchestrateTaskType(event.target.value as TaskType)}
            >
              <option value="analysis">analysis</option>
              <option value="consultation">consultation</option>
              <option value="marketplace">marketplace</option>
            </select>
            <textarea
              value={orchestratePayload}
              onChange={(event) => setOrchestratePayload(event.target.value)}
              rows={4}
              placeholder='{"goal":"refresh"}'
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={runOrchestration} disabled={busy}>
              Run orchestration
            </button>
          </div>

          {orchestrateResult ? (
            <div className="analysis-result-box">
              <p><strong>Request ID:</strong> {orchestrateResult.requestId}</p>
              <p><strong>Steps:</strong></p>
              <ul>
                {orchestrateResult.steps.map((step) => (
                  <li key={`${step.agent}-${step.summary}`}>
                    {step.agent}: {step.summary}
                  </li>
                ))}
              </ul>
              <p><strong>Output confidence:</strong> {String(orchestrateResult.output.confidence ?? "n/a")}</p>
            </div>
          ) : null}
        </article>

        <article className="milestone-card milestone-card-wide">
          <h4>3) Hardening Signals</h4>
          <p className="helper-text">
            Request IDs are generated and tracked for billing + orchestration. Basic rate limiting is applied per user and endpoint.
          </p>
          <p className="helper-text">
            Last request ID: {lastRequestId || "not set"}
          </p>
        </article>
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
