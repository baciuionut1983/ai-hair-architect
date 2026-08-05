"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Alert, Button, Card, ErrorState, Input, LoadingState } from "@/components/ui";
import type { AuthGenericAckResponse, ResetPasswordRequest } from "@/lib/contracts";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword } satisfies ResetPasswordRequest)
      });

      const payload = (await response.json()) as AuthGenericAckResponse & { error?: string };
      if (!response.ok) {
        setMessage({ tone: "error", text: payload.error || "Reset failed." });
        return;
      }

      setMessage({ tone: "ok", text: payload.message });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <ErrorState
          title="Missing or invalid reset link"
          description="Request a new password reset link to continue."
          action={
            <Link href="/forgot-password">
              <Button type="button" variant="secondary">
                Request a new link
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="text-xl font-semibold text-foreground">Reset password</h1>

      {done ? (
        <div className="mt-6 flex flex-col gap-4">
          {message ? <Alert variant="success">{message.text}</Alert> : null}
          <Link href="/login">
            <Button type="button" className="w-full">
              Go to sign in
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted">Password must be at least 8 characters.</p>
          <Button type="button" onClick={submit} loading={busy} disabled={newPassword.length < 8}>
            Reset password
          </Button>
          {message ? <Alert variant={message.tone === "ok" ? "success" : "error"}>{message.text}</Alert> : null}
        </div>
      )}
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Suspense fallback={<LoadingState />}>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
