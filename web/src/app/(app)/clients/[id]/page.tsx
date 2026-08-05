"use client";

import { ArrowLeft, Camera, CalendarDays, FlaskConical, Sparkles, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, Tabs } from "@/components/ui";
import type { TabItem } from "@/components/ui";
import type {
  AppointmentRecord,
  ClientPhotoRecord,
  ClientRecord,
  ClientTimelineResponse,
  FormulaRecord,
  TreatmentRecord
} from "@/lib/contracts";

import { useClientProfile } from "./use-client-profile";

type HistoryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; photos: ClientPhotoRecord[]; formulas: FormulaRecord[]; treatments: TreatmentRecord[] };

type AppointmentsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; appointments: AppointmentRecord[] };

const TAB_ITEMS: TabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "history", label: "History" },
  { value: "appointments", label: "Appointments" },
  { value: "ai-analysis", label: "AI Analysis" }
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
        setHistoryState({
          status: "ready",
          photos: payload.photos,
          formulas: payload.formulas,
          treatments: payload.treatments
        });
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
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{client.fullName}</h1>
      </div>

      <Tabs items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" ? <OverviewTab client={client} /> : null}
      {activeTab === "history" ? <HistoryTab state={historyState} /> : null}
      {activeTab === "appointments" ? <AppointmentsTab state={appointmentsState} /> : null}
      {activeTab === "ai-analysis" ? <AiAnalysisTab clientId={clientId} /> : null}
    </div>
  );
}

// M31 GO-3: deliberately minimal -- a short explanation and a CTA into the
// dedicated wizard at /clients/[id]/analysis/new. Not an analysis history
// list; that's explicitly out of scope for M31.
function AiAnalysisTab({ clientId }: { clientId: string }) {
  return (
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
  );
}

function OverviewTab({ client }: { client: ClientRecord }) {
  return (
    <Card className="flex flex-col gap-3">
      {client.email ? (
        <div>
          <p className="text-xs text-muted">Email</p>
          <p className="text-sm text-foreground">{client.email}</p>
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
          <p className="whitespace-pre-wrap text-sm text-foreground">{client.notes}</p>
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

function HistoryTab({ state }: { state: HistoryState }) {
  if (state.status === "loading") {
    return <LoadingState label="Loading history..." />;
  }

  if (state.status === "error") {
    return <Alert variant="error" title="Couldn't load history">Please try refreshing the page.</Alert>;
  }

  const { photos, formulas, treatments } = state;
  const isEmpty = photos.length === 0 && formulas.length === 0 && treatments.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={Camera}
        title="No history yet"
        description="Photos, formulas, and treatments logged for this client will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HistorySection icon={Camera} title="Photos" isEmpty={photos.length === 0} emptyLabel="No photos yet.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <Card key={photo.id} className="flex flex-col gap-2 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- external, owner-supplied URLs, not a build-time-known asset set for next/image */}
              <img
                src={photo.imageUrl}
                alt={photo.caption || "Client photo"}
                className="aspect-square w-full rounded-lg object-cover"
              />
              {photo.caption ? <p className="text-xs text-muted">{photo.caption}</p> : null}
              <p className="text-xs text-muted">{formatDate(photo.createdAt)}</p>
            </Card>
          ))}
        </div>
      </HistorySection>

      <HistorySection icon={FlaskConical} title="Formulas" isEmpty={formulas.length === 0} emptyLabel="No formulas yet.">
        <div className="flex flex-col gap-2">
          {formulas.map((formula) => (
            <Card key={formula.id}>
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
            <Card key={treatment.id}>
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
        <Card key={appointment.id}>
          <p className="font-medium text-foreground">{appointment.title}</p>
          <p className="mt-1 text-sm text-muted">{formatDateTime(appointment.startsAt)}</p>
          {appointment.notes ? <p className="mt-2 text-sm text-muted">{appointment.notes}</p> : null}
        </Card>
      ))}
    </div>
  );
}
