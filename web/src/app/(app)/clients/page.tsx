"use client";

import { Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Card, Dialog, EmptyState, Input, LoadingState, Textarea } from "@/components/ui";
import type { ClientCreateRequest, ClientRecord } from "@/lib/contracts";

import { validateClientForm } from "./client-form-validation";

type LoadState = "loading" | "error" | "ready";

const EMPTY_FORM = { fullName: "", email: "", phone: "", notes: "" };

// Pure fetch, no setState -- kept outside the component so both the mount
// effect and the post-create/post-delete refresh can call it without
// tripping react-hooks/set-state-in-effect, which (correctly) rejects an
// effect body that's just a call to an external function it can't prove
// is free of synchronous setState before the first await.
async function fetchClientsList(): Promise<ClientRecord[] | null> {
  try {
    const response = await fetch("/api/v1/clients", { method: "GET" });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { clients: ClientRecord[] };
    return payload.clients;
  } catch {
    return null;
  }
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Deliberately does not reset loadState to "loading" on every call: the
  // initial value already covers first mount, and re-fetching after a
  // create/delete should update the list in place rather than blanking it
  // out behind a full loading state.
  const loadClients = useCallback(async () => {
    const nextClients = await fetchClientsList();
    if (nextClients === null) {
      setLoadState("error");
      return;
    }

    setClients(nextClients);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    void (async () => {
      const nextClients = await fetchClientsList();
      if (nextClients === null) {
        setLoadState("error");
        return;
      }

      setClients(nextClients);
      setLoadState("ready");
    })();
  }, []);

  function openCreateDialog() {
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    const validationError = validateClientForm(createForm);
    if (validationError) {
      setCreateError(validationError);
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/v1/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          phone: createForm.phone.trim(),
          notes: createForm.notes.trim()
        } satisfies ClientCreateRequest)
      });

      const payload = (await response.json()) as { client?: ClientRecord; error?: string };
      if (!response.ok) {
        setCreateError(payload.error || "Could not create client. Please try again.");
        return;
      }

      setCreateOpen(false);
      await loadClients();
    } catch {
      setCreateError("Could not create client. Please try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  function openDeleteDialog(client: ClientRecord) {
    setDeleteTarget(client);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;

    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/v1/clients/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setDeleteError(payload.error || "Could not delete client. Please try again.");
        return;
      }

      setDeleteTarget(null);
      await loadClients();
    } catch {
      setDeleteError("Could not delete client. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-muted">Manage your client list and profiles.</p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add client
        </Button>
      </div>

      {loadState === "loading" ? <LoadingState label="Loading clients..." /> : null}

      {loadState === "error" ? (
        <Alert variant="error" title="Couldn't load clients">
          Please try refreshing the page.
        </Alert>
      ) : null}

      {loadState === "ready" && clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client to start building their profile and history."
          action={
            <Button type="button" onClick={openCreateDialog}>
              Add client
            </Button>
          }
        />
      ) : null}

      {loadState === "ready" && clients.length > 0 ? (
        <div className="flex flex-col gap-3">
          {clients.map((client) => (
            <Card key={client.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link
                  href={`/clients/${client.id}`}
                  className="font-medium text-foreground hover:text-accent hover:underline"
                >
                  {client.fullName}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details"}
                </p>
                <p className="mt-1 text-xs text-muted">Added {new Date(client.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`/clients/${client.id}`}>
                  <Button type="button" variant="secondary">
                    View
                  </Button>
                </Link>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => openDeleteDialog(client)}
                  aria-label={`Delete ${client.fullName}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add client"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreate} loading={createBusy}>
              Save client
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Full name"
            value={createForm.fullName}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, fullName: event.target.value }))}
          />
          <Input
            label="Email"
            type="email"
            value={createForm.email}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
          />
          <Input
            label="Phone"
            value={createForm.phone}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, phone: event.target.value }))}
          />
          <Textarea
            label="Notes"
            value={createForm.notes}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
          {createError ? <Alert variant="error">{createError}</Alert> : null}
        </div>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete client"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={handleDelete} loading={deleteBusy}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Are you sure you want to delete{" "}
          <strong className="text-foreground">{deleteTarget?.fullName}</strong>? This cannot be undone.
        </p>
        {deleteError ? (
          <Alert variant="error" className="mt-4">
            {deleteError}
          </Alert>
        ) : null}
      </Dialog>
    </div>
  );
}
