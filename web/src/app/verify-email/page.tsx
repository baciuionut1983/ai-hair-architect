"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import type { VerifyEmailRequest, VerifyEmailResponse } from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>(
    token
      ? { tone: "info", message: "Verifying your email..." }
      : { tone: "error", message: "Missing verification token." }
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const response = await fetch("/api/v1/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token } satisfies VerifyEmailRequest)
        });

        const payload = (await response.json()) as VerifyEmailResponse & { error?: string };
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setStatus({ tone: "error", message: payload.error || "Verification failed." });
          return;
        }

        setStatus({ tone: "ok", message: payload.message });
      } catch {
        if (!cancelled) {
          setStatus({ tone: "error", message: "Verification failed." });
        }
      }
    }

    void verify();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <article className="milestone-card milestone-card-wide">
      <p className={`status-line status-${status.tone}`}>{status.message}</p>
      <div className="inline-actions">
        <Link href="/#milestone1">
          <button type="button">Go to sign in</button>
        </Link>
      </div>
    </article>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="app-shell-next">
      <section className="section-next" id="verify-email">
        <div className="section-header-next">
          <h3>Email verification</h3>
        </div>
        <Suspense fallback={<p className="helper-text">Loading...</p>}>
          <VerifyEmailContent />
        </Suspense>
      </section>
    </div>
  );
}
