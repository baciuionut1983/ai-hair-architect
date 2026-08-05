"use client";

import Link from "next/link";
import { useState } from "react";

import { Alert, Button, Card, Input } from "@/components/ui";
import type { AuthGenericAckResponse, RequestPasswordResetRequest } from "@/lib/contracts";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email } satisfies RequestPasswordResetRequest)
      });

      const payload = (await response.json()) as AuthGenericAckResponse & { error?: string };
      setMessage(payload.message || payload.error || "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-foreground">Forgot password</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll email you a link to reset it.</p>

        <div className="mt-6 flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Button type="button" onClick={submit} loading={busy} disabled={!email}>
            Send reset link
          </Button>
          {message ? <Alert variant="info">{message}</Alert> : null}
        </div>

        <p className="mt-6 text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
