"use client";

import Link from "next/link";
import { useState } from "react";

import type { AuthGenericAckResponse, RequestPasswordResetRequest } from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email } satisfies RequestPasswordResetRequest)
      });

      const payload = (await response.json()) as AuthGenericAckResponse & { error?: string };
      setStatus({
        tone: response.ok ? "ok" : "error",
        message: payload.message || payload.error || "Request failed."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell-next">
      <section className="section-next" id="forgot-password">
        <div className="section-header-next">
          <h3>Forgot password</h3>
        </div>

        <article className="milestone-card milestone-card-wide">
          <div className="field-grid">
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className="inline-actions">
              <button type="button" onClick={submit} disabled={busy || !email}>
                Send reset link
              </button>
            </div>
          </div>

          {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}

          <p className="helper-text">
            <Link href="/#milestone1">Back to sign in</Link>
          </p>
        </article>
      </section>
    </div>
  );
}
