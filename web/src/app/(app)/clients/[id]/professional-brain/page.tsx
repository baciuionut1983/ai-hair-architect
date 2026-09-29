"use client";

import { AlertTriangle, ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Alert, Badge, Button, Card, ErrorState, LoadingState, Select } from "@/components/ui";
import type { HeadZone, ZoneLengthIntent, ZoneWeightIntent } from "@/lib/technical-visual-map-validators";
import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { HairStateDeltaEntry } from "@/lib/hair-state-delta";
import type { SkillCandidateMatch } from "@/lib/hair-state-delta-skill-candidate-selector";

import { useClientProfile } from "../use-client-profile";
import { useProfessionalBrainEvaluation, type ProfessionalBrainActionOutcome } from "./use-professional-brain-evaluation";
import {
  COLOR_LEVEL_OPTIONS,
  COLOR_TONE_OPTIONS,
  GLOBAL_CONDITION_OPTIONS,
  GLOBAL_DENSITY_OPTIONS,
  GLOBAL_FIBER_THICKNESS_OPTIONS,
  GLOBAL_LENGTH_OPTIONS,
  GLOBAL_TEXTURE_OPTIONS,
  UNSPECIFIED_COLOR_FACTS,
  UNSPECIFIED_GLOBAL_CUT_FACTS,
  ZONE_LENGTH_INTENT_OPTIONS,
  ZONE_OPTIONS,
  ZONE_WEIGHT_INTENT_OPTIONS,
  buildCurrentStatePayload,
  buildTargetStatePayload,
  getCandidateDomain,
  getSnapshotStatusBadgeVariant,
  getSnapshotStatusLabel,
  getTransformationBadgeVariant,
  getTransformationLabel,
  type ColorFactsInput,
  type GlobalCutFactsInput,
} from "./professional-brain-logic";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, page. The
// smallest complete, honest UI over B1's real engine: create + confirm a
// CURRENT state, create + confirm a TARGET state, then view the merged
// CUT+COLOR delta and candidate skills. This page NEVER calls Stage 5
// reasoning and NEVER starts video generation -- see the "where this flow
// stops" banner below, always rendered once an evaluation exists.
//
// COLOR is presented EXCLUSIVELY as a professional evaluation gate
// (chemical history / strand test / stylist's own determination) -- this
// page never renders a formula, developer volume, processing time, or any
// guaranteed-result claim, matching color-skill-global-single-process-
// evaluation-gate.ts's own real, authored scope.

const COLOR_EVALUATION_GATE_SKILL_KEY = "skill-color-global-single-process-evaluation-gate";

function GlobalCutFactsFields({ value, onChange, disabled }: { value: GlobalCutFactsInput; onChange: (v: GlobalCutFactsInput) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Select label="Relative length" disabled={disabled} value={value.relativeLength} onChange={(e) => onChange({ ...value, relativeLength: e.target.value as GlobalCutFactsInput["relativeLength"] })}>
        {GLOBAL_LENGTH_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label="Fiber thickness" disabled={disabled} value={value.fiberThickness} onChange={(e) => onChange({ ...value, fiberThickness: e.target.value as GlobalCutFactsInput["fiberThickness"] })}>
        {GLOBAL_FIBER_THICKNESS_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label="Density" disabled={disabled} value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as GlobalCutFactsInput["density"] })}>
        {GLOBAL_DENSITY_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label="Texture" disabled={disabled} value={value.texture} onChange={(e) => onChange({ ...value, texture: e.target.value as GlobalCutFactsInput["texture"] })}>
        {GLOBAL_TEXTURE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label="Condition" disabled={disabled} value={value.condition} onChange={(e) => onChange({ ...value, condition: e.target.value as GlobalCutFactsInput["condition"] })}>
        {GLOBAL_CONDITION_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ColorFactsFields({ value, onChange, disabled }: { value: ColorFactsInput; onChange: (v: ColorFactsInput) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Select label="Color level" disabled={disabled} value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value as ColorFactsInput["level"] })}>
        {COLOR_LEVEL_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label="Color tone" disabled={disabled} value={value.tone} onChange={(e) => onChange({ ...value, tone: e.target.value as ColorFactsInput["tone"] })}>
        {COLOR_TONE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: HairStateSnapshotRecord }) {
  const color = snapshot.payload.colorState;
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <Badge variant={getSnapshotStatusBadgeVariant(snapshot.status)}>{getSnapshotStatusLabel(snapshot.status)}</Badge>
      <span className="text-muted">
        Color level: <span className="text-foreground">{color?.level.value ?? "unspecified"}</span>{" "}
        <span className="text-xs text-muted">({color?.level.source ?? "not_yet_assessed"})</span>
      </span>
      <span className="text-muted">
        Color tone: <span className="text-foreground">{color?.tone.value ?? "unspecified"}</span>{" "}
        <span className="text-xs text-muted">({color?.tone.source ?? "not_yet_assessed"})</span>
      </span>
    </div>
  );
}

function DeltaTable({ entries }: { entries: readonly HairStateDeltaEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-muted">
            <th className="py-1 pr-3">Scope</th>
            <th className="py-1 pr-3">Field</th>
            <th className="py-1 pr-3">Current</th>
            <th className="py-1 pr-3">Target</th>
            <th className="py-1 pr-3">Change</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={`${entry.scope}-${entry.field}-${i}`} className="border-t border-border">
              <td className="py-1 pr-3 text-muted">{entry.scope}</td>
              <td className="py-1 pr-3">{entry.field}</td>
              <td className="py-1 pr-3 text-muted">
                {entry.current.value} <span className="text-xs">({entry.current.source})</span>
              </td>
              <td className="py-1 pr-3 text-muted">
                {entry.target.value} <span className="text-xs">({entry.target.source})</span>
              </td>
              <td className="py-1 pr-3">
                <Badge variant={getTransformationBadgeVariant(entry.transformation)}>{getTransformationLabel(entry.transformation)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateSkillList({ matches }: { matches: readonly SkillCandidateMatch[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-muted">No candidate skills matched yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {matches.map((match, i) => {
        const domain = getCandidateDomain(match.matchedCapability);
        const isColorGate = match.skillKey === COLOR_EVALUATION_GATE_SKILL_KEY;
        return (
          <li key={`${match.skillDefinitionId}-${match.deltaEntry.field}-${i}`} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={domain === "color" ? "warning" : "neutral"}>{domain === "color" ? "Color" : "Cut"}</Badge>
              <span className="text-sm font-medium text-foreground">{match.skillKey}</span>
              <span className="text-xs text-muted">v{match.skillVersion} - {match.matchedCapability}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{match.deterministicReason}</p>
            {isColorGate ? (
              <Alert variant="warning" className="mt-2" title="Professional evaluation required">
                This is a professional evaluation gate, not a color execution. It requires confirming the client&apos;s
                chemical history, a strand test, and the stylist&apos;s own determination. No formula, developer volume,
                processing time, or guaranteed result is generated here or anywhere in this flow.
              </Alert>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface ActionState {
  busy: boolean;
  error: string | null;
}
const IDLE: ActionState = { busy: false, error: null };

export default function ProfessionalBrainPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;

  const clientState = useClientProfile(clientId);
  const { state, createCurrentState, createTargetState, confirmSnapshot } = useProfessionalBrainEvaluation(clientId);

  const [currentGlobal, setCurrentGlobal] = useState(UNSPECIFIED_GLOBAL_CUT_FACTS);
  const [currentColor, setCurrentColor] = useState(UNSPECIFIED_COLOR_FACTS);
  const [targetGlobal, setTargetGlobal] = useState(UNSPECIFIED_GLOBAL_CUT_FACTS);
  const [targetColor, setTargetColor] = useState(UNSPECIFIED_COLOR_FACTS);
  const [targetZone, setTargetZone] = useState<HeadZone>("nape");
  const [targetLengthIntent, setTargetLengthIntent] = useState<ZoneLengthIntent>("unspecified");
  const [targetWeightIntent, setTargetWeightIntent] = useState<ZoneWeightIntent>("unspecified");

  const [createCurrentState_, setCreateCurrentState_] = useState<ActionState>(IDLE);
  const [createTargetState_, setCreateTargetState_] = useState<ActionState>(IDLE);
  const [confirmCurrentState_, setConfirmCurrentState_] = useState<ActionState>(IDLE);
  const [confirmTargetState_, setConfirmTargetState_] = useState<ActionState>(IDLE);

  function handleOutcome(outcome: ProfessionalBrainActionOutcome, setter: (s: ActionState) => void) {
    setter(outcome.ok ? IDLE : { busy: false, error: outcome.message });
  }

  async function handleCreateCurrent() {
    setCreateCurrentState_({ busy: true, error: null });
    const outcome = await createCurrentState(buildCurrentStatePayload(currentGlobal, currentColor));
    handleOutcome(outcome, setCreateCurrentState_);
  }
  async function handleCreateTarget() {
    setCreateTargetState_({ busy: true, error: null });
    const zoneIntent = targetLengthIntent === "unspecified" && targetWeightIntent === "unspecified" ? null : { zone: targetZone, lengthIntent: targetLengthIntent, weightIntent: targetWeightIntent };
    const outcome = await createTargetState(buildTargetStatePayload(targetGlobal, targetColor, zoneIntent));
    handleOutcome(outcome, setCreateTargetState_);
  }
  async function handleConfirmCurrent(snapshotId: string) {
    setConfirmCurrentState_({ busy: true, error: null });
    const outcome = await confirmSnapshot(snapshotId, null);
    handleOutcome(outcome, setConfirmCurrentState_);
  }
  async function handleConfirmTarget(snapshotId: string) {
    setConfirmTargetState_({ busy: true, error: null });
    const outcome = await confirmSnapshot(snapshotId, null);
    handleOutcome(outcome, setConfirmTargetState_);
  }

  if (clientState.status === "loading") return <LoadingState label="Loading client..." />;
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
  const client = clientState.client;

  if (state.status === "loading") return <LoadingState label="Loading evaluation..." />;
  if (state.status === "error") {
    return <ErrorState title="Couldn't load this evaluation" description="Please try refreshing the page." />;
  }

  const { currentSnapshot, targetSnapshot, evaluation } = state;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/clients/${clientId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to {client.fullName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">CUT + COLOR evaluation</h1>
      </div>

      <Alert variant="info" title="Where this flow stops">
        This evaluation computes a delta and candidate skills for cut and color, deterministically, from the states
        you confirm below. It never calls the paid AI reasoning step and never starts video generation. Turning an
        approved evaluation into a professional plan or a demonstration is a separate, explicitly authorized next
        step -- not part of this page.
      </Alert>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">1. Current state</h2>
        {!currentSnapshot ? (
          <>
            <GlobalCutFactsFields value={currentGlobal} onChange={setCurrentGlobal} disabled={createCurrentState_.busy} />
            <ColorFactsFields value={currentColor} onChange={setCurrentColor} disabled={createCurrentState_.busy} />
            <p className="text-xs text-muted">Zone-level cut facts are not set in this first evaluation slice; they stay honestly unassessed.</p>
            <div>
              <Button type="button" onClick={handleCreateCurrent} loading={createCurrentState_.busy}>
                Create current state
              </Button>
            </div>
            {createCurrentState_.error ? (
              <Alert variant="error" title="Couldn't create the current state">
                {createCurrentState_.error}
              </Alert>
            ) : null}
          </>
        ) : (
          <>
            <SnapshotSummary snapshot={currentSnapshot} />
            {currentSnapshot.status === "DRAFT" ? (
              <div>
                <Button type="button" onClick={() => handleConfirmCurrent(currentSnapshot.id)} loading={confirmCurrentState_.busy}>
                  Confirm current state
                </Button>
              </div>
            ) : null}
            {confirmCurrentState_.error ? (
              <Alert variant="error" title="Couldn't confirm">
                {confirmCurrentState_.error}
              </Alert>
            ) : null}
          </>
        )}
      </Card>

      {currentSnapshot?.status === "CONFIRMED" ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">2. Target state</h2>
          {!targetSnapshot ? (
            <>
              <GlobalCutFactsFields value={targetGlobal} onChange={setTargetGlobal} disabled={createTargetState_.busy} />
              <ColorFactsFields value={targetColor} onChange={setTargetColor} disabled={createTargetState_.busy} />
              <div className="grid grid-cols-3 gap-3">
                <Select label="Zone" disabled={createTargetState_.busy} value={targetZone} onChange={(e) => setTargetZone(e.target.value as HeadZone)}>
                  {ZONE_OPTIONS.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
                <Select label="Length intent" disabled={createTargetState_.busy} value={targetLengthIntent} onChange={(e) => setTargetLengthIntent(e.target.value as ZoneLengthIntent)}>
                  {ZONE_LENGTH_INTENT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
                <Select label="Weight intent" disabled={createTargetState_.busy} value={targetWeightIntent} onChange={(e) => setTargetWeightIntent(e.target.value as ZoneWeightIntent)}>
                  {ZONE_WEIGHT_INTENT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-muted">Only the chosen zone&apos;s intent is set; every other zone stays honestly unassessed.</p>
              <div>
                <Button type="button" onClick={handleCreateTarget} loading={createTargetState_.busy}>
                  Create target state
                </Button>
              </div>
              {createTargetState_.error ? (
                <Alert variant="error" title="Couldn't create the target state">
                  {createTargetState_.error}
                </Alert>
              ) : null}
            </>
          ) : (
            <>
              <SnapshotSummary snapshot={targetSnapshot} />
              {targetSnapshot.status === "DRAFT" ? (
                <div>
                  <Button type="button" onClick={() => handleConfirmTarget(targetSnapshot.id)} loading={confirmTargetState_.busy}>
                    Confirm target state
                  </Button>
                </div>
              ) : null}
              {confirmTargetState_.error ? (
                <Alert variant="error" title="Couldn't confirm">
                  {confirmTargetState_.error}
                </Alert>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {evaluation ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">3. Delta and candidate skills</h2>
          <DeltaTable entries={evaluation.delta.entries} />
          <CandidateSkillList matches={evaluation.candidateMatches} />
          {evaluation.unresolvedDeltas.length > 0 ? (
            <Alert variant="warning" title="Unresolved">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{evaluation.unresolvedDeltas.length} change(s) have no matching registered skill yet. This is reported honestly, never guessed.</span>
              </div>
            </Alert>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
