import type {
  ClientPhotoRecord,
  ClientTimelineResponse,
  ConsultationRecord,
  FormulaRecord,
  TreatmentRecord,
} from "@/lib/contracts";

export interface ClientHistoryData {
  photos: ClientPhotoRecord[];
  formulas: FormulaRecord[];
  treatments: TreatmentRecord[];
  consultations: ConsultationRecord[];
}

// The timeline endpoint has always returned consultations (and appointments,
// and a unified timeline) alongside photos/formulas/treatments -- this is
// the one place that decides what the History tab keeps from that payload,
// so a category silently going missing here is exactly the kind of
// regression a real client hit: a saved consultation existed, was fetched,
// and then never reached the screen.
export function buildHistoryStateFromTimeline(payload: ClientTimelineResponse): ClientHistoryData {
  return {
    photos: payload.photos,
    formulas: payload.formulas,
    treatments: payload.treatments,
    consultations: payload.consultations,
  };
}

export function isClientHistoryEmpty(
  photos: ClientPhotoRecord[],
  formulas: FormulaRecord[],
  treatments: TreatmentRecord[],
  consultations: ConsultationRecord[],
): boolean {
  return (
    photos.length === 0 && formulas.length === 0 && treatments.length === 0 && consultations.length === 0
  );
}
