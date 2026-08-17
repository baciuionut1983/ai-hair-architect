"use client";

import { ArrowLeft, Camera, CalendarDays, ClipboardList, FlaskConical, Sparkles, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ConsultationChat } from "@/components/consultation";
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, Tabs } from "@/components/ui";
import type { TabItem } from "@/components/ui";
import type {
  AppointmentRecord,
  ClientPhotoRecord,
  ClientRecord,
  ClientTimelineResponse,
  ConsultationRecord
} from "@/lib/contracts";

import { buildHistoryStateFromTimeline, isClientHistoryEmpty, type ClientHistoryData } from "./client-history-logic";
import { ConsultationList } from "./consultation-list";
import { useClientProfile } from "./use-client-profile";

type HistoryState =
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready" } & ClientHistoryData);

type AppointmentsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; appointments: AppointmentRecord[] };

const TAB_ITEMS: TabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "history", label: "History" },
  { value: "appointments", label: "Appointments" },
  { value: "ai-analysis", label: "AI Analysis" },
  { value: "consult", label: "Consult AI" }
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;

  const [activeTab, setActiveTab] = useState("overview");
  const clientState = useClientProfile(clientId);
  const [historyState, setHistoryState] = useState<HistoryState>({ status: "loading" });
  const [appointmentsState, setAppointmentsState] = useState<AppointmentsState>({ status: "loading" });

  useEffect(() => {
    if (clientState.status !== "ready") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/timeline`, { method: "GET" });
        if (cancelled) return;

        if (!response.ok) {
          setHistoryState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as ClientTimelineResponse;
        setHistoryState({ status: "ready", ...buildHistoryStateFromTimeline(payload) });
      } catch {
        if (!cancelled) {
          setHistoryState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, clientState.status]);

  useEffect(() => {
    if (clientState.status !== "ready") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/appointments?clientId=${clientId}`, { method: "GET" });
        if (cancelled) return;

        if (!response.ok) {
          setAppointmentsState({ status: "error" });
          return;
        }

        const payload = (await response.json()) as { appointments: AppointmentRecord[] };
        setAppointmentsState({ status: "ready", appointments: payload.appointments });
      } catch {
        if (!cancelled) {
          setAppointmentsState({ status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, clientState.status]);

  if (clientState.status === "loading") {
    return <LoadingState label="Loading client..." />;
  }

  if (clientState.status === "not-found") {
    return (
      <ErrorState
        icon={Users}
        title="Client not found"
        description="This client doesn't exist or is not in your client list."
        action={
          <Link href="/clients" className="text-sm text-accent hover:underline">
            Back to clients
          </Link>
        }
      />
    );
  }

  if (clientState.status === "error") {
    return (
      <ErrorState
        title="Couldn't load this client"
        description="Please try refreshing the page."
        action={
          <Link href="/clients" className="text-sm text-accent hover:underline">
            Back to clients
          </Link>
        }
      />
    );
  }

  const { client } = clientState;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to clients
        </Link>
        <h1 className="mt-2 break-words text-2xl font-semibold text-foreground">{client.fullName}</h1>
      </div>

      <Tabs items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" ? <OverviewTab client={client} /> : null}
      {activeTab === "history" ? <HistoryTab state={historyState} clientId={clientId} /> : null}
      {activeTab === "appointments" ? <AppointmentsTab state={appointmentsState} /> : null}
      {activeTab === "ai-analysis" ? (
        <AiAnalysisTab
          clientId={clientId}
          consultations={historyState.status === "ready" ? historyState.consultations : []}
        />
      ) : null}
      {activeTab === "consult" ? <ConsultationChat clientId={clientId} /> : null}
    </div>
  );
}

// M31 GO-3 started this as deliberately minimal -- a short explanation and a
// CTA into the dedicated wizard at /clients/[id]/analysis/new, with no
// analysis history list. It still isn't a full history of every analysis
// ever run (that would need a new list-all-analyses backend capability),
// but it now surfaces the consultations the stylist already chose to save,
// each linking to its full original result.
function AiAnalysisTab({ clientId, consultations }: { clientId: string; consultations: ConsultationRecord[] }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col items-start gap-3">
        <Wand2 className="h-6 w-6 text-accent" aria-hidden="true" />
        <div>
          <p className="font-medium text-foreground">Run an AI hair analysis</p>
          <p className="mt-1 text-sm text-muted">
            Answer a few questions about this client&apos;s hair and goal to get a structured haircut, color, and/or
            treatment plan.
          </p>
        </div>
        <Link href={`/clients/${clientId}/analysis/new`}>
          <Button type="button">Start a new analysis</Button>
        </Link>
      </Card>

      {consultations.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Saved consultations</h2>
          <ConsultationList clientId={clientId} consultations={consultations} />
        </div>
      ) : null}
    </div>
  );
}

function OverviewTab({ client }: { client: ClientRecord }) {
  return (
    <Card className="flex flex-col gap-3">
      {client.email ? (
        <div>
          <p className="text-xs text-muted">Email</p>
          {/* break-words: an email address has no spaces to wrap at --
              without it, a long one would force this card (and its
              ancestors) wider than a narrow phone's viewport instead of
              wrapping onto a second line. */}
          <p className="break-words text-sm text-foreground">{client.email}</p>
        </div>
      ) : null}
      {client.phone ? (
        <div>
          <p className="text-xs text-muted">Phone</p>
          <p className="text-sm text-foreground">{client.phone}</p>
        </div>
      ) : null}
      {client.notes ? (
        <div>
          <p className="text-xs text-muted">Notes</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{client.notes}</p>
        </div>
      ) : null}
      {!client.email && !client.phone && !client.notes ? (
        <p className="text-sm text-muted">No contact details or notes on file yet.</p>
      ) : null}
      <div>
        <p className="text-xs text-muted">Added</p>
        <p className="text-sm text-foreground">{formatDate(client.createdAt)}</p>
      </div>
    </Card>
  );
}

function HistoryTab({ state, clientId }: { state: HistoryState; clientId: string }) {
  if (state.status === "loading") {
    return <LoadingState label="Loading history..." />;
  }

  if (state.status === "error") {
    return <Alert variant="error" title="Couldn't load history">Please try refreshing the page.</Alert>;
  }

  const { photos, formulas, treatments, consultations } = state;
  const isEmpty = isClientHistoryEmpty(photos, formulas, treatments, consultations);

  if (isEmpty) {
    return (
      <EmptyState
        icon={Camera}
        title="No history yet"
        description="Photos, formulas, treatments, and consultations logged for this client will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HistorySection
        icon={ClipboardList}
        title="Consultations"
        isEmpty={consultations.length === 0}
        emptyLabel="No consultations yet."
      >
        <ConsultationList clientId={clientId} consultations={consultations} />
      </HistorySection>

      <HistorySection icon={Camera} title="Photos" isEmpty={photos.length === 0} emptyLabel="No photos yet.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <HistoryPhotoCard key={photo.id} photo={photo} />
          ))}
        </div>
      </HistorySection>

      <HistorySection icon={FlaskConical} title="Formulas" isEmpty={formulas.length === 0} emptyLabel="No formulas yet.">
        <div className="flex flex-col gap-2">
          {formulas.map((formula) => (
            <Card key={formula.id} className="break-words">
              <p className="font-medium text-foreground">{formula.formulaName}</p>
              <p className="mt-1 text-sm text-muted">{formula.formulaDetails}</p>
              <p className="mt-2 text-xs text-muted">{formatDate(formula.createdAt)}</p>
            </Card>
          ))}
        </div>
      </HistorySection>

      <HistorySection icon={Sparkles} title="Treatments" isEmpty={treatments.length === 0} emptyLabel="No treatments yet.">
        <div className="flex flex-col gap-2">
          {treatments.map((treatment) => (
            <Card key={treatment.id} className="break-words">
              <p className="font-medium text-foreground">{treatment.treatmentName}</p>
              <p className="mt-1 text-sm text-muted">{treatment.treatmentDetails}</p>
              <p className="mt-2 text-xs text-muted">{formatDate(treatment.createdAt)}</p>
            </Card>
          ))}
        </div>
      </HistorySection>
    </div>
  );
}

// Regression: a photo whose underlying bytes no longer exist (an old
// asset written to this app's ephemeral local storage before the
// OBJECT_STORAGE_WRITE_MODE=enabled fix, wiped by a later redeploy) showed
// a raw broken-image icon with no explanation. This never modifies or
// hides the underlying ClientPhotoRecord -- it only reacts to the actual
// <img> load failure and swaps to an honest message, matching the same
// pattern already used by AnalysisOriginalPhoto for the same class of
// problem. There is no way to recover bytes that no longer exist anywhere
// -- this is a truthful fallback, never a fabricated recovery.
function HistoryPhotoCard({ photo }: { photo: ClientPhotoRecord }) {
  const [failed, setFailed] = useState(false);

  return (
    <Card className="flex flex-col gap-2 p-2">
      {failed ? (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-surface-alt p-2 text-center text-xs text-muted">
          Photo is no longer available.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route or an external URL, not a build-time-known asset set for next/image
        <img
          src={photo.imageUrl}
          alt={photo.caption || "Client photo"}
          className="aspect-square w-full rounded-lg object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {photo.caption ? <p className="text-xs text-muted">{photo.caption}</p> : null}
      <p className="text-xs text-muted">{formatDate(photo.createdAt)}</p>
    </Card>
  );
}

function HistorySection({
  icon: Icon,
  title,
  isEmpty,
  emptyLabel,
  children
}: {
  icon: typeof Camera;
  title: string;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {isEmpty ? <p className="text-sm text-muted">{emptyLabel}</p> : children}
    </div>
  );
}

function AppointmentsTab({ state }: { state: AppointmentsState }) {
  if (state.status === "loading") {
    return <LoadingState label="Loading appointments..." />;
  }

  if (state.status === "error") {
    return (
      <Alert variant="error" title="Couldn't load appointments">
        Please try refreshing the page.
      </Alert>
    );
  }

  if (state.appointments.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No appointments yet"
        description="Appointments scheduled for this client will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {state.appointments.map((appointment) => (
        <Card key={appointment.id} className="break-words">
          <p className="font-medium text-foreground">{appointment.title}</p>
          <p className="mt-1 text-sm text-muted">{formatDateTime(appointment.startsAt)}</p>
          {appointment.notes ? <p className="mt-2 text-sm text-muted">{appointment.notes}</p> : null}
        </Card>
      ))}
    </div>
  );
}
