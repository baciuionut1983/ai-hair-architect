"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Card, ErrorState, LoadingState } from "@/components/ui";
import type { VerifyEmailRequest, VerifyEmailResponse } from "@/lib/contracts";

type VerifyState =
  | { status: "missing-token" }
  | { status: "verifying" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<VerifyState>(token ? { status: "verifying" } : { status: "missing-token" });

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
        if (cancelled) return;

        if (!response.ok) {
          setState({ status: "error", message: payload.error || "Verification failed." });
          return;
        }

        setState({ status: "ok", message: payload.message });
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Verification failed." });
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === "missing-token") {
    return (
      <Card className="w-full max-w-sm">
        <ErrorState title="Missing verification token" description="This link is incomplete or has already been used." />
      </Card>
    );
  }

  if (state.status === "verifying") {
    return (
      <Card className="w-full max-w-sm">
        <LoadingState label="Verifying your email..." />
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="text-xl font-semibold text-foreground">Email verification</h1>
      <div className="mt-6 flex flex-col gap-4">
        <Alert variant={state.status === "ok" ? "success" : "error"}>{state.message}</Alert>
        <Link href="/login">
          <Button type="button" className="w-full">
            Go to sign in
          </Button>
        </Link>
      </div>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Suspense fallback={<LoadingState />}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
