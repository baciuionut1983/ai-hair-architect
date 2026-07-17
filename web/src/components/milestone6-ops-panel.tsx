"use client";

import { useState } from "react";

import type {
  AnalyticsSnapshot,
  PushPreferenceRecord,
  PushQueueRecord,
  WorkspaceRecord
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

export function Milestone6OpsPanel() {
  const [workspaceName, setWorkspaceName] = useState("Main Salon Workspace");
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [pushPreference, setPushPreference] = useState<PushPreferenceRecord | null>(null);
  const [pushTitle, setPushTitle] = useState("Service reminder");
  const [pushBody, setPushBody] = useState("Please confirm your appointment");
  const [pushQueue, setPushQueue] = useState<PushQueueRecord[]>([]);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadWorkspaces() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/workspaces", { method: "GET" });
      const payload = (await response.json()) as { workspaces?: WorkspaceRecord[]; error?: string };
      if (!response.ok || !payload.workspaces) {
        setStatus({ tone: "error", message: payload.error || "Failed to load workspaces." });
        return;
      }

      setWorkspaces(payload.workspaces);
      setStatus({ tone: "ok", message: "Workspaces loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace() {
    if (!workspaceName.trim()) {
      setStatus({ tone: "error", message: "Workspace name is required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName })
      });

      const payload = (await response.json()) as { workspace?: WorkspaceRecord; error?: string };
      if (!response.ok || !payload.workspace) {
        setStatus({ tone: "error", message: payload.error || "Workspace create failed." });
        return;
      }

      setWorkspaces((prev) => [payload.workspace!, ...prev]);
      setStatus({ tone: "ok", message: "Workspace created." });
    } finally {
      setBusy(false);
    }
  }

  async function loadAnalytics() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/analytics/snapshot", { method: "GET" });
      const payload = (await response.json()) as { snapshot?: AnalyticsSnapshot; error?: string };
      if (!response.ok || !payload.snapshot) {
        setStatus({ tone: "error", message: payload.error || "Failed to load analytics." });
        return;
      }

      setSnapshot(payload.snapshot);
      setStatus({ tone: "ok", message: "Analytics snapshot loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function loadPushPreferences() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/push/preferences", { method: "GET" });
      const payload = (await response.json()) as { preference?: PushPreferenceRecord; error?: string };
      if (!response.ok || !payload.preference) {
        setStatus({ tone: "error", message: payload.error || "Failed to load push preferences." });
        return;
      }

      setPushPreference(payload.preference);
      setStatus({ tone: "ok", message: "Push preferences loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function togglePush() {
    const enabled = !(pushPreference?.enabled ?? true);
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/push/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          channels: pushPreference?.channels?.length ? pushPreference.channels : ["in_app"]
        })
      });

      const payload = (await response.json()) as { preference?: PushPreferenceRecord; error?: string };
      if (!response.ok || !payload.preference) {
        setStatus({ tone: "error", message: payload.error || "Push preference update failed." });
        return;
      }

      setPushPreference(payload.preference);
      setStatus({ tone: "ok", message: `Push ${payload.preference.enabled ? "enabled" : "disabled"}.` });
    } finally {
      setBusy(false);
    }
  }

  async function enqueuePush() {
    if (!pushTitle.trim() || !pushBody.trim()) {
      setStatus({ tone: "error", message: "Push title and body are required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/push/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "in_app", title: pushTitle, body: pushBody })
      });

      const payload = (await response.json()) as { item?: PushQueueRecord; error?: string };
      if (!response.ok || !payload.item) {
        setStatus({ tone: "error", message: payload.error || "Failed to enqueue push." });
        return;
      }

      setPushQueue((prev) => [payload.item!, ...prev]);
      setStatus({ tone: "ok", message: "Push message queued." });
    } finally {
      setBusy(false);
    }
  }

  async function processPushQueue() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/push/queue/process", { method: "POST" });
      const payload = (await response.json()) as { sent?: number; error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Push queue process failed." });
        return;
      }

      await loadPushQueue();
      setStatus({ tone: "ok", message: `Push queue processed. Sent: ${payload.sent ?? 0}` });
    } finally {
      setBusy(false);
    }
  }

  async function loadPushQueue() {
    const response = await fetch("/api/v1/push/queue", { method: "GET" });
    if (!response.ok) {
      setPushQueue([]);
      return;
    }

    const payload = (await response.json()) as { queue: PushQueueRecord[] };
    setPushQueue(payload.queue);
  }

  return (
    <section className="section-next" id="milestone6">
      <div className="section-header-next">
        <h3>Milestone 6 - Multi-tenant, Analytics, Push</h3>
        <span>Workspace boundaries + operational visibility</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card">
          <h4>1) Workspace Management</h4>
          <div className="field-grid">
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Workspace name"
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={createWorkspace} disabled={busy}>Create workspace</button>
            <button type="button" onClick={loadWorkspaces} disabled={busy}>Refresh workspaces</button>
          </div>
          <div className="timeline-list">
            {workspaces.length === 0 ? <p className="helper-text">No workspaces yet.</p> : null}
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="timeline-row">
                <strong>{workspace.name}</strong>
                <small>{new Date(workspace.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="milestone-card">
          <h4>2) Analytics Snapshot</h4>
          <div className="inline-actions">
            <button type="button" onClick={loadAnalytics} disabled={busy}>Load analytics</button>
          </div>

          {snapshot ? (
            <div className="analysis-result-box">
              <p><strong>Consultations:</strong> {snapshot.consultationsCount}</p>
              <p><strong>Appointments:</strong> {snapshot.appointmentsCount}</p>
              <p><strong>Reminders sent:</strong> {snapshot.remindersSentCount}</p>
              <p><strong>Active subscriptions:</strong> {snapshot.activeSubscriptionCount}</p>
              <p><strong>Video lessons:</strong> {snapshot.generatedVideoLessonsCount}</p>
            </div>
          ) : (
            <p className="helper-text">No analytics loaded.</p>
          )}
        </article>

        <article className="milestone-card milestone-card-wide">
          <h4>3) Push Preferences and Queue</h4>
          <div className="inline-actions">
            <button type="button" onClick={loadPushPreferences} disabled={busy}>Load preferences</button>
            <button type="button" onClick={togglePush} disabled={busy}>Toggle push</button>
            <button type="button" onClick={() => void loadPushQueue()} disabled={busy}>Refresh queue</button>
          </div>

          <p className="helper-text">
            Push enabled: {pushPreference ? String(pushPreference.enabled) : "unknown"}
          </p>

          <div className="field-grid field-grid-2">
            <input value={pushTitle} onChange={(event) => setPushTitle(event.target.value)} placeholder="Push title" />
            <input value={pushBody} onChange={(event) => setPushBody(event.target.value)} placeholder="Push body" />
          </div>

          <div className="inline-actions">
            <button type="button" onClick={enqueuePush} disabled={busy}>Enqueue push</button>
            <button type="button" onClick={processPushQueue} disabled={busy}>Process queue</button>
          </div>

          <div className="timeline-list">
            {pushQueue.length === 0 ? <p className="helper-text">No push jobs.</p> : null}
            {pushQueue.map((item) => (
              <div key={item.id} className="timeline-row">
                <strong>{item.title}</strong>
                <small>{item.channel} - {item.status}</small>
                <small>{item.body}</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
