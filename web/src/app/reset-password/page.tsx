"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import type { AuthGenericAckResponse, ResetPasswordRequest } from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword } satisfies ResetPasswordRequest)
      });

      const payload = (await response.json()) as AuthGenericAckResponse & { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Reset failed." });
        return;
      }

      setStatus({ tone: "ok", message: payload.message });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <article className="milestone-card milestone-card-wide">
        <p className="status-line status-error">Missing or invalid reset link.</p>
        <Link href="/forgot-password">Request a new link</Link>
      </article>
    );
  }

  return (
    <article className="milestone-card milestone-card-wide">
      {done ? (
        <>
          <p className={`status-line status-${status?.tone ?? "ok"}`}>{status?.message}</p>
          <Link href="/#milestone1">Go to sign in</Link>
        </>
      ) : (
        <div className="field-grid">
          <input
            placeholder="New password (min 8)"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div className="inline-actions">
            <button type="button" onClick={submit} disabled={busy || newPassword.length < 8}>
              Reset password
            </button>
          </div>
          {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
        </div>
      )}
    </article>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="app-shell-next">
      <section className="section-next" id="reset-password">
        <div className="section-header-next">
          <h3>Reset password</h3>
        </div>
        <Suspense fallback={<p className="helper-text">Loading...</p>}>
          <ResetPasswordContent />
        </Suspense>
      </section>
    </div>
  );
}
