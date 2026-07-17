"use client";

import { useState } from "react";

import type { BackupSnapshotRecord, OpsHealthSnapshot, RetentionRunResult } from "@/lib/contracts";

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
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
