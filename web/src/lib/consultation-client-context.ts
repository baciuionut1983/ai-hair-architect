import type { AnalysisFieldSource } from "@prisma/client";

import { listAnalysisCorrections } from "@/lib/analysis-repository";
import { listClientFormulasForOwner } from "@/lib/client-formula-repository";
import { listClientTreatmentsForOwner } from "@/lib/client-treatment-repository";
import { listConsultationsForClient } from "@/lib/consultation-repository";

// Bounds keep the context handed to the AI provider deterministic and
// finite, no matter how much real history a client accumulates over years
// of visits -- growth in stored data must never grow the prompt unbounded.
export const MAX_MEMORY_CORRECTIONS = 8;
export const MAX_MEMORY_CONSULTATIONS = 3;
export const MAX_MEMORY_SERVICES = 5;

export interface ClientMemoryCorrection {
  fieldName: string;
  newValue: unknown;
  source: AnalysisFieldSource;
  reason: string | null;
  createdAt: string;
}

export interface ClientMemoryConsultation {
  summary: string;
  nextSteps: string[];
  createdAt: string;
}

export interface ClientMemoryService {
  name: string;
  details: string;
  createdAt: string;
}

export interface ClientProfessionalMemory {
  recentCorrections: ClientMemoryCorrection[];
  recentConsultations: ClientMemoryConsultation[];
  recentFormulas: ClientMemoryService[];
  recentTreatments: ClientMemoryService[];
}

export const EMPTY_CLIENT_PROFESSIONAL_MEMORY: ClientProfessionalMemory = {
  recentCorrections: [],
  recentConsultations: [],
  recentFormulas: [],
  recentTreatments: [],
};

/**
 * Bounded, deterministic "verified professional memory" for one client --
 * distinct from the raw ConsultationMessage transcript
 * (consultation-message-repository.ts), which is ephemeral chat history.
 * Everything returned here is either a stylist-confirmed correction with
 * recorded provenance (AnalysisCorrection) or an explicitly-saved record
 * (Consultation / ClientFormula / ClientTreatment) -- never a chat message
 * promoted to fact automatically. A sentence typed into Consult AI only
 * ever becomes part of this memory through the existing explicit-confirm
 * paths that already exist for each of these sources (saving a
 * consultation, logging a formula/treatment, applying a correction) -- this
 * function only reads what has already been explicitly confirmed.
 *
 * Reuses every existing repository query as-is (analysis-repository.ts,
 * consultation-repository.ts, client-formula-repository.ts,
 * client-treatment-repository.ts) -- no parallel storage, no new tables.
 */
export async function buildClientProfessionalMemory(
  ownerUserId: string,
  clientId: string,
  latestAnalysisId: string | null,
): Promise<ClientProfessionalMemory> {
  const [corrections, consultations, formulas, treatments] = await Promise.all([
    latestAnalysisId ? listAnalysisCorrections(ownerUserId, latestAnalysisId) : Promise.resolve([]),
    listConsultationsForClient(ownerUserId, clientId),
    listClientFormulasForOwner(ownerUserId, clientId),
    listClientTreatmentsForOwner(ownerUserId, clientId),
  ]);

  return {
    // listAnalysisCorrections returns oldest-first; the most recent ones
    // are the most relevant to "why is this field what it is right now".
    recentCorrections: corrections.slice(-MAX_MEMORY_CORRECTIONS).map((correction) => ({
      fieldName: correction.fieldName,
      newValue: correction.newValue,
      source: correction.source,
      reason: correction.reason,
      createdAt: correction.createdAt,
    })),
    // consultations/formulas/treatments are already newest-first.
    recentConsultations: consultations.slice(0, MAX_MEMORY_CONSULTATIONS).map((consultation) => ({
      summary: consultation.summary,
      nextSteps: consultation.nextSteps,
      createdAt: consultation.createdAt,
    })),
    recentFormulas: formulas.slice(0, MAX_MEMORY_SERVICES).map((formula) => ({
      name: formula.formulaName,
      details: formula.formulaDetails,
      createdAt: formula.createdAt,
    })),
    recentTreatments: treatments.slice(0, MAX_MEMORY_SERVICES).map((treatment) => ({
      name: treatment.treatmentName,
      details: treatment.treatmentDetails,
      createdAt: treatment.createdAt,
    })),
  };
}
