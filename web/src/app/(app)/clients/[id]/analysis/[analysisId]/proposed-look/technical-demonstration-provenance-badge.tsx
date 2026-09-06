import { Badge, type BadgeVariant } from "@/components/ui";

import { technicalDemonstrationProvenanceLabel, type CuttingStepFieldSourceLevel } from "./technical-demonstration-plan-logic";

// Technical Demonstration, Stage 2 -- the field-level provenance badge
// (OBSERVED / INFERRED / UNKNOWN / PROFESSIONAL_OVERRIDE). This is what
// makes the honesty of the Decision Lock's provenance model VISIBLE to the
// professional, not just present in the data: OBSERVED reads as a
// confidently-known fact (success/green), INFERRED as a reasonable
// deterministic default (neutral), and PROFESSIONAL_OVERRIDE stands out
// distinctly (warning/amber) -- exactly the "professional-approved,
// deliberately different from the engine's own suggestion" signal a
// professional needs to trust it above a plain inference. UNKNOWN never
// renders through this component at all in practice (see
// resolveStepFieldRows -- an UNKNOWN field is excluded from the "populated"
// list this badge decorates), but is mapped defensively anyway.
export function getTechnicalDemonstrationProvenanceBadgeVariant(provenance: string): BadgeVariant {
  switch (provenance) {
    case "OBSERVED":
      return "success";
    case "PROFESSIONAL_OVERRIDE":
      return "warning";
    case "INFERRED":
    case "UNKNOWN":
    default:
      return "neutral";
  }
}

// Stage 2.5.g.4 -- `sourceLevel` is optional and purely presentational: it
// only ever changes the LABEL TEXT for the one genuinely ambiguous case
// (see technicalDemonstrationProvenanceLabel's own header comment); the
// badge's own color/variant is deliberately unchanged either way -- an
// upstream-inherited professional value is still professional-sourced,
// still worth the same visual weight, just worded so a professional never
// expects "Reset to original" to do something it structurally cannot do.
export function TechnicalDemonstrationProvenanceBadge({ provenance, sourceLevel }: { provenance: string; sourceLevel?: CuttingStepFieldSourceLevel }) {
  return (
    <Badge variant={getTechnicalDemonstrationProvenanceBadgeVariant(provenance)} className="text-[0.65rem]">
      {technicalDemonstrationProvenanceLabel(provenance, sourceLevel)}
    </Badge>
  );
}
