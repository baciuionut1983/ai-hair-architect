"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Button, Card, Input, LoadingState, Select } from "@/components/ui";
import type { AuthRegisterRequest, AuthRegisterResponse, UserRole } from "@/lib/contracts";
import { resolveLanguageCodeFromBrowserTag } from "@/lib/language-registry";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("professional");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    setSuccessMessage(null);
    try {
      // Registry-wide guess (any of the world languages the platform
      // recognizes -- see language-registry.ts), not narrowed to just
      // en/ro. Purely a one-time initial guess: the account's own
      // User.locale (or an explicit selector choice) always wins
      // afterward.
      const locale = resolveLanguageCodeFromBrowserTag(typeof navigator === "undefined" ? undefined : navigator.language);
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role, locale } satisfies AuthRegisterRequest)
      });

      const payload = (await response.json()) as AuthRegisterResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error || "Registration failed.");
        return;
      }

      // M26: registration never creates a session -- the account stays
      // unverified until the emailed link is clicked, then sign-in happens
      // separately through /login.
      setSuccessMessage(payload.message);
    } catch {
      setError("Registration failed. Please try again.");
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
        <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
        <p className="mt-1 text-sm text-muted">Start your free AI Hair Architect account.</p>

        {successMessage ? (
          <div className="mt-6 flex flex-col gap-4">
            <Alert variant="success" title="Check your email">
              {successMessage}
            </Alert>
            <Link href="/login">
              <Button type="button" variant="secondary" className="w-full">
                Go to sign in
              </Button>
            </Link>
          </div>
        ) : (
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
              autoComplete="new-password"
            />
            <Select label="I am a..." value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="professional">Professional stylist</option>
              <option value="salon">Salon</option>
              <option value="consumer">Consumer</option>
            </Select>

            {error ? <Alert variant="error">{error}</Alert> : null}

            <Button type="button" onClick={handleSubmit} loading={busy} disabled={!email || password.length < 8}>
              Create account
            </Button>
            <p className="text-xs text-muted">Password must be at least 8 characters.</p>
          </div>
        )}

        <p className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
