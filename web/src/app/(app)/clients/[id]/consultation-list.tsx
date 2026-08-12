import Link from "next/link";

import { Card } from "@/components/ui";
import type { ConsultationRecord } from "@/lib/contracts";

// Shared between the History tab and the AI Analysis tab -- both need to
// show the same saved consultations, and both link into the same
// /clients/[id]/analysis/[analysisId] view, so the rendering exists here
// exactly once instead of twice.
export function ConsultationList({
  clientId,
  consultations,
}: {
  clientId: string;
  consultations: ConsultationRecord[];
}) {
  if (consultations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {consultations.map((consultation) => (
        <Card key={consultation.id} className="flex flex-col gap-2">
          <p className="text-xs text-muted">{new Date(consultation.createdAt).toLocaleDateString()}</p>
          <p className="text-sm text-foreground">{consultation.summary}</p>
          {consultation.nextSteps.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-muted">
              {consultation.nextSteps.map((step, index) => (
                <li key={`${consultation.id}-${index}`}>{step}</li>
              ))}
            </ul>
          ) : null}
          <Link
            href={`/clients/${clientId}/analysis/${consultation.analysisId}`}
            className="self-start text-xs text-accent hover:underline"
          >
            View full analysis
          </Link>
        </Card>
      ))}
    </div>
  );
}
