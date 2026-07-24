"use client";

import { useState } from "react";

import type {
  BackupSnapshotRecord,
  OpsHealthSnapshot,
  RestoreGovernanceAlertsResponse,
  RestoreGovernanceHealthResponse,
  RestoreGovernanceObservabilityResponse,
  RestoreGovernanceWindow,
  RetentionRunResult,
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

interface AuditEventLike {
  id: string;
  module: string;
  action: string;
  createdAt: string;
}

export function Milestone7OpsGovernancePanel() {
  const [health, setHealth] = useState<OpsHealthSnapshot | null>(null);
  const [events, setEvents] = useState<AuditEventLike[]>([]);
  const [backups, setBackups] = useState<BackupSnapshotRecord[]>([]);
  const [backupLabel, setBackupLabel] = useState("pre-release-checkpoint");
  const [retentionDays, setRetentionDays] = useState("30");
  const [dryRun, setDryRun] = useState(true);
  const [retentionResult, setRetentionResult] = useState<RetentionRunResult | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreWindow, setRestoreWindow] = useState<RestoreGovernanceWindow>("24h");
  const [restoreHealth, setRestoreHealth] = useState<RestoreGovernanceHealthResponse | null>(null);
  const [restoreObservability, setRestoreObservability] = useState<RestoreGovernanceObservabilityResponse | null>(null);
  const [restoreHealthLoading, setRestoreHealthLoading] = useState(false);
  const [restoreObservabilityLoading, setRestoreObservabilityLoading] = useState(false);
  const [restoreAlertsLoading, setRestoreAlertsLoading] = useState(false);
  const [restoreHealthError, setRestoreHealthError] = useState<string | null>(null);
  const [restoreObservabilityError, setRestoreObservabilityError] = useState<string | null>(null);
  const [restoreAlertsError, setRestoreAlertsError] = useState<string | null>(null);
  const [restoreAlerts, setRestoreAlerts] = useState<RestoreGovernanceAlertsResponse | null>(null);

  function resolveApiError(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== "object") {
      return fallback;
    }

    const data = payload as { error?: unknown; requestId?: unknown };
    const errorText = typeof data.error === "string" && data.error.length > 0
      ? data.error
      : fallback;
    const requestIdText = typeof data.requestId === "string" && data.requestId.length > 0
      ? data.requestId
      : null;

    return requestIdText ? `${errorText} (requestId: ${requestIdText})` : errorText;
  }

  async function loadHealth() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/ops/health", { method: "GET" });
      const payload = (await response.json()) as { health?: OpsHealthSnapshot; error?: string };
      if (!response.ok || !payload.health) {
        setStatus({ tone: "error", message: payload.error || "Failed to load health." });
        return;
      }
      setHealth(payload.health);
      setStatus({ tone: "ok", message: "Ops health loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function loadAuditEvents() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/ops/audit/events", { method: "GET" });
      const payload = (await response.json()) as { events?: AuditEventLike[]; error?: string };
      if (!response.ok || !payload.events) {
        setStatus({ tone: "error", message: payload.error || "Failed to load audit events." });
        return;
      }
      setEvents(payload.events);
      setStatus({ tone: "ok", message: "Audit events loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function createBackup() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/ops/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: backupLabel })
      });
      const payload = (await response.json()) as { backup?: BackupSnapshotRecord; error?: string };
      if (!response.ok || !payload.backup) {
        setStatus({ tone: "error", message: payload.error || "Backup creation failed." });
        return;
      }
      setBackups((prev) => [payload.backup!, ...prev]);
      setStatus({ tone: "ok", message: "Backup snapshot created." });
    } finally {
      setBusy(false);
    }
  }

  async function loadBackups() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/ops/backups", { method: "GET" });
      const payload = (await response.json()) as { backups?: BackupSnapshotRecord[]; error?: string };
      if (!response.ok || !payload.backups) {
        setStatus({ tone: "error", message: payload.error || "Failed to load backups." });
        return;
      }
      setBackups(payload.backups);
      setStatus({ tone: "ok", message: "Backup list loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function runRetention() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/ops/retention/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanDays: Number(retentionDays), dryRun })
      });
      const payload = (await response.json()) as { result?: RetentionRunResult; error?: string };
      if (!response.ok || !payload.result) {
        setStatus({ tone: "error", message: payload.error || "Retention run failed." });
        return;
      }
      setRetentionResult(payload.result);
      setStatus({ tone: "ok", message: `Retention ${payload.result.dryRun ? "dry-run" : "execution"} completed.` });
    } finally {
      setBusy(false);
    }
  }

  async function loadRestoreGovernanceHealth() {
    setRestoreHealthLoading(true);
    setRestoreHealthError(null);
    try {
      const response = await fetch("/api/v1/ops/backups/restore-runs/health", { method: "GET" });
      const payload = (await response.json()) as RestoreGovernanceHealthResponse | { error?: string; requestId?: string };
      if (!response.ok || !payload || (payload as { error?: string }).error) {
        setRestoreHealthError(resolveApiError(payload, "Failed to load restore governance health."));
        return;
      }

      setRestoreHealth(payload as RestoreGovernanceHealthResponse);
    } finally {
      setRestoreHealthLoading(false);
    }
  }

  async function loadRestoreGovernanceObservability(window: RestoreGovernanceWindow = restoreWindow) {
    setRestoreObservabilityLoading(true);
    setRestoreObservabilityError(null);
    try {
      const response = await fetch(`/api/v1/ops/backups/restore-runs/observability?window=${window}`, { method: "GET" });
      const payload = (await response.json()) as RestoreGovernanceObservabilityResponse | { error?: string; requestId?: string };
      if (!response.ok || !payload || (payload as { error?: string }).error) {
        setRestoreObservabilityError(resolveApiError(payload, "Failed to load restore governance observability."));
        return;
      }

      setRestoreObservability(payload as RestoreGovernanceObservabilityResponse);
    } finally {
      setRestoreObservabilityLoading(false);
    }
  }

  async function loadRestoreGovernanceAlerts(window: RestoreGovernanceWindow = restoreWindow) {
    setRestoreAlertsLoading(true);
    setRestoreAlertsError(null);
    try {
      const response = await fetch(`/api/v1/ops/backups/restore-runs/alerts?window=${window}`, { method: "GET" });
      const payload = (await response.json()) as RestoreGovernanceAlertsResponse | { error?: string; requestId?: string };
      if (!response.ok || !payload || (payload as { error?: string }).error) {
        setRestoreAlertsError(resolveApiError(payload, "Failed to load restore governance alerts."));
        return;
      }

      setRestoreAlerts(payload as RestoreGovernanceAlertsResponse);
    } finally {
      setRestoreAlertsLoading(false);
    }
  }

  async function refreshRestoreGovernance() {
    await Promise.all([
      loadRestoreGovernanceHealth(),
      loadRestoreGovernanceObservability(restoreWindow),
      loadRestoreGovernanceAlerts(restoreWindow),
    ]);
  }

  function healthReasonLabel(code: string): string {
    switch (code) {
      case "STALE_MAINTENANCE_RUNS":
        return "Stale maintenance runs detected";
      case "STALE_RETENTION_RUNS":
        return "Stale retention runs detected";
      case "STALE_RESTORE_RUNS":
        return "Stale restore runs detected";
      case "RECENT_FAILURE_ATTENTION":
        return "Recent failure attention threshold reached";
      default:
        return code;
    }
  }

  return (
    <section className="section-next" id="milestone7">
      <div className="section-header-next">
        <h3>Milestone 7 - Ops Governance, Backup, Retention</h3>
        <span>Operational safety and lifecycle controls</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card">
          <h4>1) Ops Health</h4>
          <div className="inline-actions">
            <button type="button" onClick={loadHealth} disabled={busy}>Load health</button>
          </div>
          {health ? (
            <div className="analysis-result-box">
              <p><strong>Users:</strong> {health.usersCount}</p>
              <p><strong>Clients:</strong> {health.clientsCount}</p>
              <p><strong>Consultations:</strong> {health.consultationsCount}</p>
              <p><strong>Queue backlog:</strong> {health.queueBacklogCount}</p>
              <p><strong>Audit events:</strong> {health.auditEventsCount}</p>
            </div>
          ) : (
            <p className="helper-text">Health snapshot not loaded.</p>
          )}
        </article>

        <article className="milestone-card">
          <h4>2) Audit Visibility</h4>
          <div className="inline-actions">
            <button type="button" onClick={loadAuditEvents} disabled={busy}>Load audit events</button>
          </div>
          <div className="timeline-list">
            {events.length === 0 ? <p className="helper-text">No audit events loaded.</p> : null}
            {events.slice(0, 8).map((item) => (
              <div key={item.id} className="timeline-row">
                <strong>{item.module}</strong>
                <small>{item.action}</small>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="milestone-card">
          <h4>3) Backup Snapshots</h4>
          <div className="field-grid">
            <input value={backupLabel} onChange={(event) => setBackupLabel(event.target.value)} placeholder="Backup label" />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={createBackup} disabled={busy}>Create backup</button>
            <button type="button" onClick={loadBackups} disabled={busy}>Load backups</button>
          </div>
          <div className="timeline-list">
            {backups.length === 0 ? <p className="helper-text">No backups yet.</p> : null}
            {backups.slice(0, 8).map((item) => (
              <div key={item.id} className="timeline-row">
                <strong>{item.label}</strong>
                <small>clients: {item.snapshot.clientsCount}, consultations: {item.snapshot.consultationsCount}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="milestone-card">
          <h4>4) Retention Job</h4>
          <div className="field-grid">
            <input
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
              placeholder="Older than days"
            />
            <label className="helper-text">
              <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> dry-run
            </label>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={runRetention} disabled={busy}>Run retention</button>
          </div>
          {retentionResult ? (
            <div className="analysis-result-box">
              <p><strong>Dry-run:</strong> {String(retentionResult.dryRun)}</p>
              <p><strong>Push affected:</strong> {retentionResult.pushQueueAffected}</p>
              <p><strong>Audit affected:</strong> {retentionResult.auditEventsAffected}</p>
            </div>
          ) : null}
        </article>

        <article className="milestone-card">
          <h4>5) Restore Governance Observability</h4>
          <div className="field-grid">
            <label>
              Window
              <select
                value={restoreWindow}
                onChange={(event) => setRestoreWindow(event.target.value as RestoreGovernanceWindow)}
                disabled={restoreObservabilityLoading}
              >
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </select>
            </label>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={loadRestoreGovernanceHealth} disabled={restoreHealthLoading}>Load restore health</button>
            <button type="button" onClick={() => loadRestoreGovernanceObservability(restoreWindow)} disabled={restoreObservabilityLoading}>Load observability</button>
            <button type="button" onClick={() => loadRestoreGovernanceAlerts(restoreWindow)} disabled={restoreAlertsLoading}>Load alerts</button>
            <button type="button" onClick={refreshRestoreGovernance} disabled={restoreHealthLoading || restoreObservabilityLoading || restoreAlertsLoading}>Refresh governance</button>
          </div>

          {restoreHealthLoading ? <p className="helper-text">Loading restore health...</p> : null}
          {restoreHealthError ? <p className="status-line status-error">{restoreHealthError}</p> : null}
          {restoreHealth ? (
            <div className="analysis-result-box">
              <p><strong>Health state:</strong> {restoreHealth.state}</p>
              <p><strong>Stale restore runs:</strong> {restoreHealth.currentState.staleRestoreRuns}</p>
              <p><strong>Stale maintenance runs:</strong> {restoreHealth.currentState.staleMaintenanceRuns}</p>
              <p><strong>Stale retention runs:</strong> {restoreHealth.currentState.staleRetentionRuns}</p>
              <p><strong>Active governance operations:</strong> {restoreHealth.currentState.activeGovernanceOperations}</p>
              <p><strong>Recent failure attention (24h):</strong> {restoreHealth.recentFailureAttentionCount24h}</p>
              {restoreHealth.reasons.length === 0 ? (
                <p className="helper-text">No active health alerts.</p>
              ) : (
                <ul>
                  {restoreHealth.reasons.map((reason) => (
                    <li key={reason}>{healthReasonLabel(reason)}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {restoreObservabilityLoading ? <p className="helper-text">Loading restore observability...</p> : null}
          {restoreObservabilityError ? <p className="status-line status-error">{restoreObservabilityError}</p> : null}
          {restoreObservability ? (
            <div className="analysis-result-box">
              <p><strong>Window:</strong> {restoreObservability.window}</p>
              <p><strong>Restore started:</strong> {restoreObservability.windowMetrics.restore.restoreRunsStarted}</p>
              <p><strong>Restore completed:</strong> {restoreObservability.windowMetrics.restore.restoreRunsCompleted}</p>
              <p><strong>Restore failed:</strong> {restoreObservability.windowMetrics.restore.restoreRunsFailed}</p>
              <p><strong>Restore indeterminate:</strong> {restoreObservability.windowMetrics.restore.restoreRunsIndeterminate}</p>
              <p><strong>Success rate:</strong> {restoreObservability.windowMetrics.restore.restoreSuccessRate ?? "n/a"}</p>
              <p><strong>P50 duration (ms):</strong> {restoreObservability.windowMetrics.restore.restoreP50DurationMs ?? "n/a"}</p>
              <p><strong>P95 duration (ms):</strong> {restoreObservability.windowMetrics.restore.restoreP95DurationMs ?? "n/a"}</p>
              <p><strong>Average attempts:</strong> {restoreObservability.windowMetrics.restore.averageAttemptsUsed ?? "n/a"}</p>
              <p><strong>Maintenance completed/failed:</strong> {restoreObservability.windowMetrics.maintenance.completedRuns}/{restoreObservability.windowMetrics.maintenance.failedRuns}</p>
              <p><strong>Retention completed/failed:</strong> {restoreObservability.windowMetrics.retention.completedRuns}/{restoreObservability.windowMetrics.retention.failedRuns}</p>
              <p><strong>Top failure codes:</strong> {restoreObservability.failuresByCode.length}</p>
              <p><strong>Recent failures:</strong> {restoreObservability.recentFailures.length}</p>
              <p><strong>Timeline buckets:</strong> {restoreObservability.timeline.length}</p>
              {restoreObservability.recentFailures.length === 0 ? (
                <p className="helper-text">No recent restore governance failures in selected window.</p>
              ) : (
                <div className="timeline-list">
                  {restoreObservability.recentFailures.slice(0, 8).map((item) => (
                    <div key={`${item.runType}:${item.runId}`} className="timeline-row">
                      <strong>{item.runType}</strong>
                      <small>{item.status}</small>
                      <small>{item.finalErrorCode ?? "NO_CODE"}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {restoreAlertsLoading ? <p className="helper-text">Loading restore governance alerts...</p> : null}
          {restoreAlertsError ? <p className="status-line status-error">{restoreAlertsError}</p> : null}
          {restoreAlerts ? (
            <div className="analysis-result-box">
              <p><strong>Alert state:</strong> {restoreAlerts.state}</p>
              <p><strong>Active alerts:</strong> {restoreAlerts.alerts.length}</p>
              {restoreAlerts.alerts.length === 0 ? (
                <p className="helper-text">No active restore governance alerts in selected window.</p>
              ) : (
                <div className="timeline-list">
                  {restoreAlerts.alerts.map((alert) => (
                    <div key={alert.code} className="timeline-row">
                      <strong>{alert.code}</strong>
                      <small>{alert.severity}</small>
                      <small>{alert.actualValue} {alert.comparator} warning:{alert.warningThreshold} degraded:{alert.degradedThreshold}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </article>
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
