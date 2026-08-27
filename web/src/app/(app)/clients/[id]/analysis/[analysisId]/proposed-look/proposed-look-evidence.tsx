import { Alert, Card } from "@/components/ui";
// Type-only reuse of the exact shape Stage 3's assembler already froze into
// `evidenceSnapshot` -- do NOT redefine a parallel interface. Phase 2 has a
// single vertical ("cutting") and assembleCuttingProposalCreationInput is the
// only writer of this field, so the cast is safe here.
import type { CuttingEvidenceSnapshot } from "@/lib/proposal-assembler";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";

type ObservationKey = keyof CuttingEvidenceSnapshot["observations"];

const OBSERVATION_FIELDS: ReadonlyArray<{ key: ObservationKey; label: string }> = [
  { key: "hairType", label: "Hair type" },
  { key: "density", label: "Density" },
  { key: "porosity", label: "Porosity" },
  { key: "hairCondition", label: "Hair condition" },
  { key: "hairTexture", label: "Hair texture" },
  { key: "hairLength", label: "Hair length" },
  { key: "growthPattern", label: "Growth pattern" },
  { key: "faceShape", label: "Face shape" },
  { key: "headShape", label: "Head shape" },
];

export interface ProposalEvidencePanelProps {
  evidenceSnapshot: Record<string, unknown>;
}

// Two CLEARLY SEPARATE labeled sub-sections -- a locked requirement:
//   1. "Current observed evidence": the 9 raw observation fields, each a
//      label/value pair, humanized, or an explicit "Not recorded" when null.
//   2. "Derived safety constraints": engine-derived safetyNotes /
//      contraindications, rendered with the SAME Alert variant convention
//      plan-base.tsx already uses (warning list / error list).
// A reader must never mistake a derived/engine-output contraindication for a
// fact the stylist personally observed.
export function ProposalEvidencePanel({ evidenceSnapshot }: ProposalEvidencePanelProps) {
  const evidence = evidenceSnapshot as unknown as CuttingEvidenceSnapshot;
  const { observations, derivedSafety } = evidence;
  const safetyNotes = derivedSafety.safetyNotes;
  const contraindications = derivedSafety.contraindications;

  return (
    <Card className="flex flex-col gap-4">
      <section>
        <h4 className="text-sm font-semibold text-foreground">Current observed evidence</h4>
        <p className="text-xs text-muted">
          What the analysis recorded about the hair as it is now. This is the evidence the proposal was built from.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OBSERVATION_FIELDS.map(({ key, label }) => {
            const raw = observations[key];
            const isRecorded = typeof raw === "string" && raw.length > 0;
            return (
              <div key={key}>
                <p className="text-xs text-muted">{label}</p>
                {isRecorded ? (
                  <p className="text-sm text-foreground">{humanizeEnumValue(raw)}</p>
                ) : (
                  <p className="text-sm italic text-muted">Not recorded</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-foreground">Derived safety constraints</h4>
        <p className="text-xs text-muted">
          Engine-derived output from the analysis -- not observations the stylist entered directly.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {safetyNotes.length > 0 ? (
            <Alert variant="warning" title="Safety notes">
              <ul className="list-inside list-disc">
                {safetyNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {contraindications.length > 0 ? (
            <Alert variant="error" title="Contraindications">
              <ul className="list-inside list-disc">
                {contraindications.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {safetyNotes.length === 0 && contraindications.length === 0 ? (
            <p className="text-sm text-muted">No derived safety constraints were recorded for this proposal.</p>
          ) : null}
        </div>
      </section>
    </Card>
  );
}
