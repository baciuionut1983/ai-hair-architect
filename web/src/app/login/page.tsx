"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Button, Card, Input, LoadingState } from "@/components/ui";
import type { AuthGenericAckResponse, AuthLoginRequest, AuthSessionResponse } from "@/lib/contracts";

type LoginErrorState = { message: string; unverifiedEmail?: string } | null;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginErrorState>(null);
  const [busy, setBusy] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function redirectIfAlreadyAuthenticated() {
      const response = await fetch("/api/v1/auth/me", { method: "GET" });
      if (cancelled) return;

      if (response.ok) {
        router.replace("/dashboard");
        return;
      }

      setCheckingSession(false);
    }

    void redirectIfAlreadyAuthenticated();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    setResendStatus(null);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password } satisfies AuthLoginRequest)
      });

      const payload = (await response.json()) as AuthSessionResponse & { error?: string; message?: string };

      if (!response.ok) {
        if (payload.error === "EMAIL_NOT_VERIFIED") {
          setError({ message: payload.message || "Please verify your email before signing in.", unverifiedEmail: email });
          return;
        }

        setError({ message: payload.message || payload.error || "Sign in failed." });
        return;
      }

      router.replace("/dashboard");
    } catch {
      setError({ message: "Sign in failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function handleResendVerification() {
    if (!error?.unverifiedEmail) return;

    setBusy(true);
    try {
      const response = await fetch("/api/v1/auth/resend-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: error.unverifiedEmail })
      });

      const payload = (await response.json()) as AuthGenericAckResponse;
      setResendStatus(payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Checking your session..." />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Welcome back to AI Hair Architect.</p>

        <div className="mt-6 flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />

          {error ? (
            <Alert variant="error" title="Couldn't sign you in">
              {error.message}
              {error.unverifiedEmail ? (
                <div className="mt-2">
                  <Button type="button" variant="secondary" onClick={handleResendVerification} disabled={busy}>
                    Resend verification email
                  </Button>
                </div>
              ) : null}
            </Alert>
          ) : null}

          {resendStatus ? <Alert variant="info">{resendStatus}</Alert> : null}

          <Button type="button" onClick={handleSubmit} loading={busy} disabled={!email || !password}>
            Sign in
          </Button>
        </div>

        <div className="mt-6 flex flex-col gap-1 text-sm text-muted">
          <Link href="/forgot-password" className="text-accent hover:underline">
            Forgot password?
          </Link>
          <p>
            No account yet?{" "}
            <Link href="/register" className="text-accent hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
