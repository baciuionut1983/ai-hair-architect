"use client";

import { useState } from "react";

import { Alert, Button, Select } from "@/components/ui";
import {
  HEAD_ZONES,
  ZONE_RELATIONSHIP_TYPES,
  type HeadZone,
  type MapAdjustmentEntry,
  type ZoneRelationshipEntry,
  type ZoneRelationshipType,
} from "@/lib/technical-visual-map-validators";

import { HEAD_ZONE_LABELS, ZONE_RELATIONSHIP_TYPE_LABELS, availableTargetZones, formatRelationship } from "./technical-visual-map-logic";
import type { TechnicalVisualMapActionOutcome } from "./use-technical-visual-map";

export interface TechnicalVisualMapRelationshipsProps {
  relationships: ZoneRelationshipEntry[];
  // Present only for a DRAFT map -- when absent, this renders the read-only
  // list alone (used for CONFIRMED/SUPERSEDED maps).
  onAdd?: (adjustment: MapAdjustmentEntry) => Promise<TechnicalVisualMapActionOutcome>;
}

// Technical Visual Map, Stage 4 -- a small structured editor for explicit
// zone relationships, never free-text. The "relative to" dropdown only ever
// offers zones that (a) aren't the selected source zone itself, and (b)
// don't already have a relationship with it in either direction --
// structurally preventing a same-zone or duplicate relationship from ever
// being submitted, rather than validating after the fact. The relationship
// TYPE dropdown is populated directly from the locked ZONE_RELATIONSHIP_TYPES
// vocabulary, so an unsupported relation can never be selected.
export function TechnicalVisualMapRelationships({ relationships, onAdd }: TechnicalVisualMapRelationshipsProps) {
  const [sourceZone, setSourceZone] = useState<HeadZone>(HEAD_ZONES[0]);
  const [targetZone, setTargetZone] = useState<HeadZone | "">("");
  const [relationshipType, setRelationshipType] = useState<ZoneRelationshipType>(ZONE_RELATIONSHIP_TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = availableTargetZones(relationships, sourceZone);
  // Keep the selected target valid whenever the available list changes (e.g.
  // after sourceZone changes, or after a relationship is added) -- never
  // silently submit a stale/no-longer-available target.
  const effectiveTarget = targets.includes(targetZone as HeadZone) ? (targetZone as HeadZone) : "";

  async function handleAdd() {
    if (!onAdd || !effectiveTarget) return;
    setSaving(true);
    setError(null);
    const outcome = await onAdd({
      target: "zone_relationship_add",
      relationship: {
        sourceZone,
        relationship: relationshipType,
        targetZone: effectiveTarget,
        source: "professional_adjustment",
      },
      source: "professional",
    });
    if (!outcome.ok) {
      setError(outcome.message);
    } else {
      setTargetZone("");
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
      <h4 className="text-sm font-semibold text-foreground">Zone relationships</h4>

      {relationships.length === 0 ? (
        <p className="text-xs text-muted">No relationships recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {relationships.map((relationship, index) => (
            <li
              key={`${relationship.sourceZone}-${relationship.relationship}-${relationship.targetZone}-${index}`}
              className="text-sm text-foreground"
            >
              {formatRelationship(relationship)}
            </li>
          ))}
        </ul>
      )}

      {onAdd ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              label="Zone"
              value={sourceZone}
              onChange={(event) => {
                setSourceZone(event.target.value as HeadZone);
                setTargetZone("");
              }}
            >
              {HEAD_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {HEAD_ZONE_LABELS[zone]}
                </option>
              ))}
            </Select>
            <Select
              label="Relationship"
              value={relationshipType}
              onChange={(event) => setRelationshipType(event.target.value as ZoneRelationshipType)}
            >
              {ZONE_RELATIONSHIP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ZONE_RELATIONSHIP_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            <Select label="Relative to" value={effectiveTarget} onChange={(event) => setTargetZone(event.target.value as HeadZone)}>
              <option value="">Select a zone</option>
              {targets.map((zone) => (
                <option key={zone} value={zone}>
                  {HEAD_ZONE_LABELS[zone]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={handleAdd} loading={saving} disabled={!effectiveTarget}>
              Add relationship
            </Button>
          </div>
          {targets.length === 0 ? (
            <p className="text-xs text-muted">
              Every other zone already has a relationship with {HEAD_ZONE_LABELS[sourceZone]}.
            </p>
          ) : null}
          {error ? (
            <Alert variant="error" title="Couldn't add relationship">
              {error}
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
