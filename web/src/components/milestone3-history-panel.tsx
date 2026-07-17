"use client";

import { useCallback, useMemo, useState } from "react";

import type {
  AppointmentCreateRequest,
  ClientRecord,
  ClientTimelineResponse,
  FormulaCreateRequest,
  NotificationRecord,
  TreatmentCreateRequest
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

type ReminderType = "appointment" | "follow_up" | "maintenance";

const defaultReminderMinutes = "1440";

export function Milestone3HistoryPanel() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [timelineData, setTimelineData] = useState<ClientTimelineResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const [photoUrl, setPhotoUrl] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");

  const [formulaName, setFormulaName] = useState("");
  const [formulaDetails, setFormulaDetails] = useState("");

  const [treatmentName, setTreatmentName] = useState("");
  const [treatmentDetails, setTreatmentDetails] = useState("");

  const [appointmentTitle, setAppointmentTitle] = useState("Follow-up visit");
  const [appointmentStartsAt, setAppointmentStartsAt] = useState("");
  const [appointmentReminderMinutes, setAppointmentReminderMinutes] = useState(defaultReminderMinutes);
  const [appointmentReminderType, setAppointmentReminderType] = useState<ReminderType>("appointment");
  const [appointmentNotes, setAppointmentNotes] = useState("");

  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedClientName = useMemo(() => {
    return clients.find((entry) => entry.id === selectedClientId)?.fullName ?? "";
  }, [clients, selectedClientId]);

  const loadNotifications = useCallback(async () => {
    const response = await fetch("/api/v1/notifications", { method: "GET" });
    if (!response.ok) {
      setNotifications([]);
      return;
    }

    const payload = (await response.json()) as { notifications: NotificationRecord[] };
    setNotifications(payload.notifications);
  }, []);

  const refreshTimeline = useCallback(async (clientId: string) => {
    if (!clientId) {
      setTimelineData(null);
      return;
    }

    const response = await fetch(`/api/v1/clients/${clientId}/timeline`, { method: "GET" });
    if (!response.ok) {
      setTimelineData(null);
      return;
    }

    const payload = (await response.json()) as ClientTimelineResponse;
    setTimelineData(payload);
  }, []);

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/v1/clients", { method: "GET" });
    if (!response.ok) {
      setStatus({ tone: "error", message: "Sign in in M1 panel before using Milestone 3." });
      setClients([]);
      return;
    }

    const payload = (await response.json()) as { clients: ClientRecord[] };
    setClients(payload.clients);

    if (!selectedClientId && payload.clients.length > 0) {
      const firstClient = payload.clients[0];
      setSelectedClientId(firstClient.id);
      await refreshTimeline(firstClient.id);
      return;
    }

    if (selectedClientId) {
      await refreshTimeline(selectedClientId);
    }
  }, [refreshTimeline, selectedClientId]);

  async function addPhoto() {
    if (!selectedClientId || !photoUrl.trim()) {
      setStatus({ tone: "error", message: "Select a client and add image URL." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/clients/${selectedClientId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photoUrl, caption: photoCaption })
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Photo save failed." });
        return;
      }

      setPhotoUrl("");
      setPhotoCaption("");
      await refreshTimeline(selectedClientId);
      setStatus({ tone: "ok", message: "Photo added to timeline." });
    } finally {
      setBusy(false);
    }
  }

  async function addFormula() {
    if (!selectedClientId) {
      setStatus({ tone: "error", message: "Select a client first." });
      return;
    }

    const payload: FormulaCreateRequest = {
      formulaName: formulaName.trim(),
      formulaDetails: formulaDetails.trim()
    };

    if (!payload.formulaName || !payload.formulaDetails) {
      setStatus({ tone: "error", message: "Formula name and details are required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/clients/${selectedClientId}/formulas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: result.error || "Formula save failed." });
        return;
      }

      setFormulaName("");
      setFormulaDetails("");
      await refreshTimeline(selectedClientId);
      setStatus({ tone: "ok", message: "Formula added." });
    } finally {
      setBusy(false);
    }
  }

  async function addTreatment() {
    if (!selectedClientId) {
      setStatus({ tone: "error", message: "Select a client first." });
      return;
    }

    const payload: TreatmentCreateRequest = {
      treatmentName: treatmentName.trim(),
      treatmentDetails: treatmentDetails.trim()
    };

    if (!payload.treatmentName || !payload.treatmentDetails) {
      setStatus({ tone: "error", message: "Treatment name and details are required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/clients/${selectedClientId}/treatments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: result.error || "Treatment save failed." });
        return;
      }

      setTreatmentName("");
      setTreatmentDetails("");
      await refreshTimeline(selectedClientId);
      setStatus({ tone: "ok", message: "Treatment added." });
    } finally {
      setBusy(false);
    }
  }

  async function scheduleAppointment() {
    if (!selectedClientId) {
      setStatus({ tone: "error", message: "Select a client first." });
      return;
    }

    const payload: AppointmentCreateRequest = {
      clientId: selectedClientId,
      title: appointmentTitle.trim(),
      startsAt: appointmentStartsAt.trim(),
      reminderMinutesBefore: Number(appointmentReminderMinutes),
      reminderType: appointmentReminderType,
      notes: appointmentNotes.trim()
    };

    if (!payload.title || !payload.startsAt) {
      setStatus({ tone: "error", message: "Appointment title and date are required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: result.error || "Appointment save failed." });
        return;
      }

      setAppointmentNotes("");
      setAppointmentStartsAt("");
      await refreshTimeline(selectedClientId);
      setStatus({ tone: "ok", message: "Appointment scheduled." });
    } finally {
      setBusy(false);
    }
  }

  async function runReminderJob() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/notifications/reminders/run", { method: "POST" });
      const payload = (await response.json()) as { remindersCreated?: number; error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Reminder job failed." });
        return;
      }

      await loadNotifications();
      setStatus({ tone: "ok", message: `Reminder job executed. Created: ${payload.remindersCreated ?? 0}` });
    } finally {
      setBusy(false);
    }
  }

  async function markNotificationsRead() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const payload = (await response.json()) as { updated?: number; error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: payload.error || "Mark read failed." });
        return;
      }

      await loadNotifications();
      setStatus({ tone: "ok", message: `Marked ${payload.updated ?? 0} notifications as read.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-next" id="milestone3">
      <div className="section-header-next">
        <h3>Milestone 3 - History, Calendar, Notifications</h3>
        <span>Timeline + appointments + reminders</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card milestone-card-wide">
          <h4>1) Client Timeline</h4>
          <div className="inline-actions">
            <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.fullName}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void loadClients()} disabled={busy}>
              Refresh clients
            </button>
            <button
              type="button"
              onClick={() => void refreshTimeline(selectedClientId)}
              disabled={busy || !selectedClientId}
            >
              Refresh timeline
            </button>
          </div>

          <p className="helper-text">
            Selected client: {selectedClientName || "none"}
          </p>

          <div className="timeline-list">
            {timelineData?.timeline.length ? null : <p className="helper-text">No timeline events yet.</p>}
            {timelineData?.timeline.map((entry) => (
              <div key={`${entry.kind}-${entry.id}`} className="timeline-row">
                <strong>{entry.kind.toUpperCase()}</strong>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
                <p>{entry.title}</p>
                <small>{entry.details}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="milestone-card">
          <h4>2) Add Photo</h4>
          <div className="field-grid">
            <input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="Image URL" />
            <input
              value={photoCaption}
              onChange={(event) => setPhotoCaption(event.target.value)}
              placeholder="Caption"
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={addPhoto} disabled={busy || !selectedClientId}>
              Save photo
            </button>
          </div>
        </article>

        <article className="milestone-card">
          <h4>3) Formula</h4>
          <div className="field-grid">
            <input
              value={formulaName}
              onChange={(event) => setFormulaName(event.target.value)}
              placeholder="Formula name"
            />
            <textarea
              value={formulaDetails}
              onChange={(event) => setFormulaDetails(event.target.value)}
              placeholder="Formula details"
              rows={3}
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={addFormula} disabled={busy || !selectedClientId}>
              Save formula
            </button>
          </div>
        </article>

        <article className="milestone-card">
          <h4>4) Treatment</h4>
          <div className="field-grid">
            <input
              value={treatmentName}
              onChange={(event) => setTreatmentName(event.target.value)}
              placeholder="Treatment name"
            />
            <textarea
              value={treatmentDetails}
              onChange={(event) => setTreatmentDetails(event.target.value)}
              placeholder="Treatment details"
              rows={3}
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={addTreatment} disabled={busy || !selectedClientId}>
              Save treatment
            </button>
          </div>
        </article>

        <article className="milestone-card">
          <h4>5) Appointments</h4>
          <div className="field-grid">
            <input
              value={appointmentTitle}
              onChange={(event) => setAppointmentTitle(event.target.value)}
              placeholder="Appointment title"
            />
            <input
              value={appointmentStartsAt}
              onChange={(event) => setAppointmentStartsAt(event.target.value)}
              placeholder="ISO date: 2026-08-01T10:00:00.000Z"
            />
            <input
              value={appointmentReminderMinutes}
              onChange={(event) => setAppointmentReminderMinutes(event.target.value)}
              placeholder="Reminder minutes before"
            />
            <select
              value={appointmentReminderType}
              onChange={(event) => setAppointmentReminderType(event.target.value as ReminderType)}
            >
              <option value="appointment">appointment</option>
              <option value="follow_up">follow_up</option>
              <option value="maintenance">maintenance</option>
            </select>
            <textarea
              value={appointmentNotes}
              onChange={(event) => setAppointmentNotes(event.target.value)}
              placeholder="Appointment notes"
              rows={3}
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={scheduleAppointment} disabled={busy || !selectedClientId}>
              Schedule
            </button>
          </div>
        </article>

        <article className="milestone-card">
          <h4>6) Notifications</h4>
          <div className="inline-actions">
            <button type="button" onClick={() => void loadNotifications()} disabled={busy}>
              Refresh notifications
            </button>
            <button type="button" onClick={runReminderJob} disabled={busy}>
              Run reminder job
            </button>
            <button type="button" onClick={markNotificationsRead} disabled={busy}>
              Mark all read
            </button>
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? <p className="helper-text">No notifications yet.</p> : null}
            {notifications.map((item) => (
              <div key={item.id} className="notification-row">
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{item.readAt ? "Read" : "Unread"}</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
