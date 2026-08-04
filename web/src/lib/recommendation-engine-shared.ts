/**
 * M27: shared foundation for the Hair Recommendation Engine's domain modules
 * (haircut, color, treatment). Contains only what is genuinely common to at
 * least two domain engines -- the base recommendation shape, the confidence
 * penalty formula, and generic string utilities. Domain-specific rule logic
 * (technique selection, formula direction, protocol steps, etc.) stays in
 * each domain's own engine file and must never be moved here.
 */

export interface BaseRecommendationPlan {
  stylistExplanation: string;
  clientExplanation: string;
  professionalReason: string;
  warnings: string[];
  contraindications: string[];
  assumptions: string[];
  missingData: string[];
  confidence: number;
  notes?: string[];
  stylistValidationDisclaimer: string;
  version: string;
}

/**
 * Extracted verbatim from cutting-plan-engine.ts's original calculateConfidence
 * -- same weights, same clamp band, same rounding. Any domain engine using this
 * function inherits an identical confidence formula; do not fork per domain
 * without a deliberate, separately-approved reason.
 */
export function calculateRecommendationConfidence(
  missingData: string[],
  warnings: string[],
  contraindications: string[]
): number {
  const missingPenalty = missingData.length * 0.03;
  const warningPenalty = warnings.length * 0.015;
  const contraindicationPenalty = contraindications.length * 0.01;
  const value = 0.95 - missingPenalty - warningPenalty - contraindicationPenalty;
  return Math.max(0.58, Math.min(0.96, Number(value.toFixed(2))));
}

export function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function readable(value: string): string {
  return value.replaceAll("_", " ");
}
