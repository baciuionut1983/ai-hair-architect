import { Badge } from "@/components/ui";
import type { PreserveConstraintEntry } from "@/lib/technical-visual-map-validators";

import { DOWNSTREAM_ONLY_PRESERVE_CONSTRAINT_TYPES, HEAD_ZONE_LABELS, PRESERVE_CONSTRAINT_TYPE_LABELS } from "./technical-visual-map-logic";

export interface TechnicalVisualMapConstraintsProps {
  constraints: PreserveConstraintEntry[];
}

// Technical Visual Map, Stage 4 -- read-only "Preserve & safety constraints"
// section. Perimeter never appears as a zone anywhere in this UI -- when a
// `preserve_perimeter_weight` constraint exists it is shown ONLY here.
//
// A `preserve_identity` / `preserve_face_proportions` / `do_not_modify_
// unrelated_appearance` entry is a valid Stage 2 vocabulary member but is
// documented as a downstream Photo/Video generation invariant, not something
// this map's own generation currently produces -- if one is ever present
// (e.g. from a future producer) it is labeled "not part of this map yet"
// rather than presented as if it were an active constraint here, per Stage
// 2's own explicit "do not prematurely expose downstream-only options"
// boundary.
export function TechnicalVisualMapConstraints({ constraints }: TechnicalVisualMapConstraintsProps) {
  if (constraints.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-alt p-4">
        <h4 className="text-sm font-semibold text-foreground">Preserve &amp; safety constraints</h4>
        <p className="mt-1 text-xs text-muted">No constraints recorded for this map yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-alt p-4">
      <h4 className="text-sm font-semibold text-foreground">Preserve &amp; safety constraints</h4>
      <ul className="flex flex-col gap-2">
        {constraints.map((constraint, index) => {
          const isDownstreamOnly = DOWNSTREAM_ONLY_PRESERVE_CONSTRAINT_TYPES.has(constraint.type);
          return (
            <li
              key={`${constraint.type}-${constraint.zone ?? ""}-${index}`}
              className="rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{PRESERVE_CONSTRAINT_TYPE_LABELS[constraint.type]}</span>
                {constraint.zone ? <Badge variant="neutral">{HEAD_ZONE_LABELS[constraint.zone]}</Badge> : null}
                {isDownstreamOnly ? (
                  <Badge variant="warning">Not part of this map yet -- future Photo/Video invariant</Badge>
                ) : null}
              </div>
              {constraint.reference ? <p className="mt-1 break-words text-xs text-muted">{constraint.reference}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
