"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AuthSessionResponse,
  ClientCreateRequest,
  ClientRecord,
  Locale,
  UserRole
} from "@/lib/contracts";
import { dictionary, resolveLocale } from "@/lib/i18n";

const LOCALE_STORAGE_KEY = "aha-locale";

interface AuthForm {
  email: string;
  password: string;
  role: UserRole;
}

interface ClientForm {
  fullName: string;
  email: string;
  phone: string;
  notes: string;
}

const defaultAuthForm: AuthForm = {
  email: "",
  password: "",
  role: "professional"
};

const defaultClientForm: ClientForm = {
  fullName: "",
  email: "",
  phone: "",
  notes: ""
};

export function Milestone1FoundationPanel() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return "en";
    }

    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return resolveLocale(stored ?? navigator.language);
  });
  const [authForm, setAuthForm] = useState<AuthForm>(defaultAuthForm);
  const [clientForm, setClientForm] = useState<ClientForm>(defaultClientForm);
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  const copy = useMemo(() => dictionary[locale], [locale]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/v1/clients", { method: "GET" });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { clients: ClientRecord[] };
    setClients(payload.clients);
  }, []);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/v1/auth/me", { method: "GET" });
    if (!response.ok) {
      setSession(null);
      setClients([]);
      return;
    }

    const payload = (await response.json()) as { authenticated: boolean; user: AuthSessionResponse["user"] };
    if (!payload.authenticated) {
      return;
    }

    const sessionLike: AuthSessionResponse = {
      token: "cookie-session",
      user: payload.user
    };
    setSession(sessionLike);
    await loadClients();
  }, [loadClients]);

  async function register() {
    setIsBusy(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...authForm, locale })
      });

      const payload = (await response.json()) as AuthSessionResponse | { error: string };
      if (!response.ok) {
        setStatusMessage((payload as { error: string }).error || "Register failed");
        return;
      }

      setSession(payload as AuthSessionResponse);
      setStatusMessage("Registered and signed in.");
      await loadClients();
    } finally {
      setIsBusy(false);
    }
  }

  async function signIn() {
    setIsBusy(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authForm.email,
          password: authForm.password
        })
      });

      const payload = (await response.json()) as AuthSessionResponse | { error: string };
      if (!response.ok) {
        setStatusMessage((payload as { error: string }).error || "Sign in failed");
        return;
      }

      setSession(payload as AuthSessionResponse);
      setStatusMessage("Signed in.");
      await loadClients();
    } finally {
      setIsBusy(false);
    }
  }

  async function createClient() {
    if (!session) {
      setStatusMessage("Sign in first.");
      return;
    }

    const payload: ClientCreateRequest = {
      fullName: clientForm.fullName,
      email: clientForm.email,
      phone: clientForm.phone,
      notes: clientForm.notes
    };

    setIsBusy(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/v1/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        setStatusMessage(errorPayload.error || "Client creation failed");
        return;
      }

      setStatusMessage("Client saved.");
      setClientForm(defaultClientForm);
      await loadClients();
    } finally {
      setIsBusy(false);
    }
  }

  async function removeClient(clientId: string) {
    setIsBusy(true);
    setStatusMessage("");
    try {
      const response = await fetch(`/api/v1/clients/${clientId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        setStatusMessage(errorPayload.error || "Delete failed");
        return;
      }

      setStatusMessage("Client removed.");
      await loadClients();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="section-next" id="milestone1">
      <div className="section-header-next">
        <h3>{copy.milestoneTitle}</h3>
        <span>Auth + I18n + Client CRUD</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card">
          <h4>{copy.language}</h4>
          <div className="inline-actions">
            <button type="button" className={locale === "en" ? "active-choice" : ""} onClick={() => setLocale("en")}>
              EN
            </button>
            <button type="button" className={locale === "ro" ? "active-choice" : ""} onClick={() => setLocale("ro")}>
              RO
            </button>
          </div>
          <p className="helper-text">Auto-detect active with manual override and persistence.</p>
        </article>

        <article className="milestone-card">
          <h4>{copy.authTitle}</h4>
          <div className="inline-actions">
            <button type="button" onClick={() => void loadSession()} disabled={isBusy}>
              Refresh session
            </button>
          </div>
          <div className="field-grid">
            <input
              placeholder="Email"
              value={authForm.email}
              onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <input
              placeholder="Password (min 8)"
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
            />
            <select
              value={authForm.role}
              onChange={(event) =>
                setAuthForm((prev) => ({ ...prev, role: event.target.value as UserRole }))
              }
            >
              <option value="professional">Professional</option>
              <option value="salon">Salon</option>
              <option value="consumer">Consumer</option>
            </select>
            <div className="inline-actions">
              <button type="button" onClick={register} disabled={isBusy}>
                {copy.register}
              </button>
              <button type="button" onClick={signIn} disabled={isBusy}>
                {copy.signIn}
              </button>
            </div>
          </div>
          <p className="helper-text">
            Session: {session ? `signed in as ${session.user.email}` : "not authenticated"}
          </p>
        </article>

        <article className="milestone-card milestone-card-wide">
          <h4>{copy.createClient}</h4>
          <div className="field-grid field-grid-2">
            <input
              placeholder="Full name"
              value={clientForm.fullName}
              onChange={(event) => setClientForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />
            <input
              placeholder="Email"
              value={clientForm.email}
              onChange={(event) => setClientForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <input
              placeholder="Phone"
              value={clientForm.phone}
              onChange={(event) => setClientForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <input
              placeholder="Notes"
              value={clientForm.notes}
              onChange={(event) => setClientForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={createClient} disabled={isBusy}>
              {copy.createClient}
            </button>
          </div>

          <h4 className="clients-heading">{copy.clients}</h4>
          <div className="client-list">
            {clients.length === 0 ? <p className="helper-text">No clients yet.</p> : null}
            {clients.map((client) => (
              <div key={client.id} className="client-row">
                <div>
                  <strong>{client.fullName}</strong>
                  <p>{client.email || "No email"}</p>
                </div>
                <button type="button" onClick={() => removeClient(client.id)} disabled={isBusy}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </article>
      </div>

      {statusMessage ? <p className="status-line">{statusMessage}</p> : null}
    </section>
  );
}
