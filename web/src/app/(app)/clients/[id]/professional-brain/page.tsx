"use client";

import { AlertTriangle, ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Alert, Badge, Button, Card, ErrorState, LoadingState, Select } from "@/components/ui";
import type { HeadZone, ZoneLengthIntent, ZoneWeightIntent } from "@/lib/technical-visual-map-validators";
import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { HairStateColorEntry, HairStateFact, HairStatePerimeterRelationship } from "@/lib/hair-state-snapshot-validators";
import type { HairStateDeltaEntry } from "@/lib/hair-state-delta";
import { useUiLanguage } from "@/lib/ui-language-context";
import { PROFESSIONAL_BRAIN_DOMAINS, type ProfessionalBrainDomain } from "@/lib/professional-brain-domain-intent-contracts";
import type { ProfessionalBrainStylingGapReport } from "@/lib/professional-brain-styling-gap";

import { useClientProfile } from "../use-client-profile";
import { useProfessionalBrainEvaluation, type ProfessionalBrainActionOutcome } from "./use-professional-brain-evaluation";
import {
  COLOR_EVALUATION_GATE_SKILL_KEY,
  COLOR_LEVEL_OPTIONS,
  COLOR_TONE_OPTIONS,
  GLOBAL_CONDITION_OPTIONS,
  GLOBAL_DENSITY_OPTIONS,
  GLOBAL_FIBER_THICKNESS_OPTIONS,
  GLOBAL_LENGTH_OPTIONS,
  GLOBAL_TEXTURE_OPTIONS,
  PERIMETER_RELATIONSHIP_OPTIONS,
  UNSPECIFIED_COLOR_FACTS,
  UNSPECIFIED_GLOBAL_CUT_FACTS,
  ZONE_LENGTH_INTENT_OPTIONS,
  ZONE_OPTIONS,
  ZONE_WEIGHT_INTENT_OPTIONS,
  buildCurrentStatePayload,
  buildTargetStatePayload,
  describeUnresolvedDelta,
  getExpectedConfirmedSnapshotId,
  getSnapshotStatusBadgeVariant,
  getSnapshotStatusLabel,
  getTransformationBadgeVariant,
  getTransformationLabel,
  groupCandidateMatchesBySkill,
  hasColorCandidate,
  pbTranslate,
  resolveClientDomainIntent,
  type ColorFactsInput,
  type GlobalCutFactsInput,
  type GroupedSkillCandidate,
  type PbStringKey,
  type TargetZoneIntentInput,
} from "./professional-brain-logic";

// AI Hair Architect, Professional Brain CUT+COLOR FLOW, page.
//
// B2 -- the smallest complete, honest UI over B1's real engine: create +
// confirm a CURRENT state, create + confirm a TARGET state, then view the
// merged CUT+COLOR delta and candidate skills. Never calls Stage 5
// reasoning, never starts video generation.
//
// B2.1 -- explicit "what's missing for color" disclosure (chemical
// history/strand test are UNKNOWN for the real client, never implied
// known); safe "start a new evaluation" round using the real previously-
// confirmed id, never a hardcoded null.
//
// B2.2 -- a real production test (straight-line cut + color base 7)
// surfaced three further gaps, all fixed here:
//  (1) There was no way to express "straight line / one length / straight
//      perimeter" at all -- only lengthIntent/weightIntent were editable.
//      Added perimeterRelationship (the field that actually models this)
//      plus an explicit hint distinguishing it from "shorten" (a
//      different axis -- how much length changes -- which, verified
//      directly against the registered skill set, currently matches NO
//      skill: only skill-cutting-graduated declares REDUCE_LENGTH, and
//      its own applicableZones use a different zone vocabulary than
//      HeadZone, so it can never actually match a real per-zone delta;
//      see the B2.2 audit report for the full trace).
//  (2) Repeated matches for the same skill (e.g. one color skill matching
//      both a real change and an unchanged-but-still-required dimension)
//      read as two unrelated findings. Now grouped per skill.
//  (3) The pre-confirm summary showed only color. Now shows every CUT
//      global fact, the edited zone's intent/perimeter, and color --
//      all with provenance.
// Also: intent-derived "Preserved" (a stated wish from an unknown
// baseline) is now labeled distinctly from a confirmed, both-sides-known
// "Preserved" -- see professional-brain-logic.ts's own
// isIntentDerivedField/getTransformationLabel header.

function GlobalCutFactsFields({
  value,
  onChange,
  disabled,
  t,
}: {
  value: GlobalCutFactsInput;
  onChange: (v: GlobalCutFactsInput) => void;
  disabled: boolean;
  t: (key: PbStringKey) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Select label={t("relativeLengthLabel")} disabled={disabled} value={value.relativeLength} onChange={(e) => onChange({ ...value, relativeLength: e.target.value as GlobalCutFactsInput["relativeLength"] })}>
        {GLOBAL_LENGTH_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label={t("fiberThicknessLabel")} disabled={disabled} value={value.fiberThickness} onChange={(e) => onChange({ ...value, fiberThickness: e.target.value as GlobalCutFactsInput["fiberThickness"] })}>
        {GLOBAL_FIBER_THICKNESS_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label={t("densityLabel")} disabled={disabled} value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as GlobalCutFactsInput["density"] })}>
        {GLOBAL_DENSITY_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label={t("textureLabel")} disabled={disabled} value={value.texture} onChange={(e) => onChange({ ...value, texture: e.target.value as GlobalCutFactsInput["texture"] })}>
        {GLOBAL_TEXTURE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label={t("conditionLabel")} disabled={disabled} value={value.condition} onChange={(e) => onChange({ ...value, condition: e.target.value as GlobalCutFactsInput["condition"] })}>
        {GLOBAL_CONDITION_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ColorFactsFields({
  value,
  onChange,
  disabled,
  t,
}: {
  value: ColorFactsInput;
  onChange: (v: ColorFactsInput) => void;
  disabled: boolean;
  t: (key: PbStringKey) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Select label={t("colorLevelLabel")} disabled={disabled} value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value as ColorFactsInput["level"] })}>
        {COLOR_LEVEL_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <Select label={t("colorToneLabel")} disabled={disabled} value={value.tone} onChange={(e) => onChange({ ...value, tone: e.target.value as ColorFactsInput["tone"] })}>
        {COLOR_TONE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </div>
  );
}

// "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 1 -- domain selection,
// BEFORE the CURRENT/TARGET forms. Any non-empty, combinable subset of
// CUT/COLOR/STYLING. Editable only while no CURRENT snapshot exists yet
// for this round (`editable=false` once one does) -- the choice is
// embedded into the CURRENT draft's own payload on creation and frozen
// exactly like every other fact there once confirmed (see
// buildCurrentStatePayload/resolveClientDomainIntent's own headers).
function DomainSelectionFields({
  value,
  onChange,
  editable,
  t,
}: {
  value: readonly ProfessionalBrainDomain[];
  onChange: (v: readonly ProfessionalBrainDomain[]) => void;
  editable: boolean;
  t: (key: PbStringKey) => string;
}) {
  const domainLabel: Record<ProfessionalBrainDomain, PbStringKey> = { cut: "cutBadge", color: "colorBadge", styling: "stylingBadge" };
  function toggle(domain: ProfessionalBrainDomain) {
    if (!editable) return;
    onChange(value.includes(domain) ? value.filter((d) => d !== domain) : [...value, domain]);
  }
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{t("domainSelectionHeading")}</h2>
      <p className="text-sm text-muted">{t("domainSelectionHelp")}</p>
      <div className="flex flex-wrap gap-4">
        {PROFESSIONAL_BRAIN_DOMAINS.map((domain) => (
          <label key={domain} className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={value.includes(domain)} disabled={!editable} onChange={() => toggle(domain)} className="h-4 w-4 rounded border-border" />
            {t(domainLabel[domain])}
          </label>
        ))}
      </div>
      {!editable ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{t("domainActiveLabel")}</span>
          {value.map((d) => (
            <Badge key={d} variant="neutral">
              {t(domainLabel[d])}
            </Badge>
          ))}
          <span>-- {t("domainSelectionFrozenNote")}</span>
        </p>
      ) : value.length === 0 ? (
        <p className="text-xs text-error">{t("domainSelectionEmptyError")}</p>
      ) : null}
    </Card>
  );
}

function StylingGapNotice({ gap, t }: { gap: ProfessionalBrainStylingGapReport; t: (key: PbStringKey) => string }) {
  return (
    <Alert variant="warning" title={t("stylingGapTitle")}>
      <p className="text-sm">{t("stylingGapIntro")}</p>
      <p className="mt-2 text-xs font-semibold uppercase text-muted">{t("stylingGapMissingContractsHeading")}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {gap.missingContracts.map((line, i) => (
          <li key={i} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-semibold uppercase text-muted">{t("stylingGapMissingFactsHeading")}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {gap.missingFacts.map((line, i) => (
          <li key={i} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function FactLine({ label, fact }: { label: string; fact: HairStateFact<string> | { value: string; source: string } }) {
  return (
    <div>
      <span className="text-muted">{label}: </span>
      <span className="text-foreground">{fact.value}</span> <span className="text-xs text-muted">({fact.source})</span>
    </div>
  );
}

const UNASSESSED: HairStateFact<string> = { value: "unspecified", source: "not_yet_assessed" };

// B2.2 -- the pre-confirm/post-confirm summary now shows EVERY CUT global
// fact plus the edited zone's own intent/perimeter (found by scanning for
// the one zone with a professional_input-sourced fact, since this page
// only ever edits one), plus color -- never color alone. All with
// provenance, matching "arată toate valorile CUT și COLOR și proveniența
// lor, nu doar culoarea" exactly.
function SnapshotSummary({ snapshot, activeDomains, t }: { snapshot: HairStateSnapshotRecord; activeDomains: readonly ProfessionalBrainDomain[]; t: (key: PbStringKey) => string }) {
  const { globalState, zones } = snapshot.payload;
  const color: HairStateColorEntry | undefined = snapshot.payload.colorState;
  const editedZone = zones.find((z) => z.lengthIntent.source === "professional_input" || z.weightIntent.source === "professional_input" || z.perimeterRelationship.source === "professional_input");
  const showCut = activeDomains.includes("cut");
  const showColor = activeDomains.includes("color");

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={getSnapshotStatusBadgeVariant(snapshot.status)}>{getSnapshotStatusLabel(snapshot.status)}</Badge>
        <span className="text-xs font-semibold uppercase text-muted">{t("confirmedValuesHeading")}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {showCut ? (
          <>
            <FactLine label={t("relativeLengthLabel")} fact={globalState.relativeLength} />
            <FactLine label={t("fiberThicknessLabel")} fact={globalState.fiberThickness} />
            <FactLine label={t("densityLabel")} fact={globalState.density} />
            <FactLine label={t("textureLabel")} fact={globalState.texture} />
            <FactLine label={t("conditionLabel")} fact={globalState.condition} />
          </>
        ) : null}
        {showColor ? (
          <>
            <FactLine label={t("colorLevelLabel")} fact={color?.level ?? UNASSESSED} />
            <FactLine label={t("colorToneLabel")} fact={color?.tone ?? UNASSESSED} />
          </>
        ) : null}
      </div>
      {showCut && editedZone ? (
        <div>
          <p className="text-xs font-semibold uppercase text-muted">
            {t("zoneLabel")}: {editedZone.zone}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <FactLine label={t("lengthIntentLabel")} fact={editedZone.lengthIntent} />
            <FactLine label={t("weightIntentLabel")} fact={editedZone.weightIntent} />
            <FactLine label={t("perimeterRelationshipLabel")} fact={editedZone.perimeterRelationship} />
          </div>
        </div>
      ) : null}
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
                <Badge variant={getTransformationBadgeVariant(entry.transformation)}>{getTransformationLabel(entry.transformation, entry.field)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// B2.2 -- grouped by skill (see groupCandidateMatchesBySkill's own
// header): a live-caught finding was that two rows for the SAME skill
// (one real change, one unchanged-but-still-required dimension) read as
// two unrelated findings. Every real match is still shown, just under
// one card per skill.
function CandidateSkillList({ groups, t }: { groups: readonly GroupedSkillCandidate[]; t: (key: PbStringKey) => string }) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted">{t("noCandidatesYet")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {groups.map((group) => {
        const isColorGate = group.skillKey === COLOR_EVALUATION_GATE_SKILL_KEY;
        return (
          <li key={group.skillDefinitionId} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={group.domain === "color" ? "warning" : "neutral"}>{group.domain === "color" ? t("colorBadge") : t("cutBadge")}</Badge>
              <span className="text-sm font-medium text-foreground">{group.skillKey}</span>
              <span className="text-xs text-muted">v{group.skillVersion}</span>
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {group.entries.map((entry, i) => (
                <li key={i} className="text-xs text-muted">
                  {entry.matchedCapability} ({getTransformationLabel(entry.deltaEntry.transformation, entry.deltaEntry.field)}) -- {entry.deterministicReason}
                </li>
              ))}
            </ul>
            {isColorGate ? <p className="mt-1 text-xs font-medium text-warning">{t("evaluationGateNote")}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

// B2.2 -- lists every unresolved delta explicitly (scope/field/target/
// transformation), never just a count. Never invents a missing
// capability name -- see describeUnresolvedDelta's own header.
function UnresolvedDeltaList({ entries, language, t }: { entries: readonly HairStateDeltaEntry[]; language: Parameters<typeof describeUnresolvedDelta>[1]; t: (key: PbStringKey) => string }) {
  if (entries.length === 0) return null;
  return (
    <Alert variant="warning" title={t("unresolvedTitle")}>
      <p className="text-sm">{t("unresolvedIntro")}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {entries.map((entry, i) => (
          <li key={i} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{describeUnresolvedDelta(entry, language)}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function ColorEvaluationDisclosure({ t }: { t: (key: PbStringKey) => string }) {
  return (
    <Alert variant="warning" title={t("colorMissingTitle")}>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        <li>{t("colorMissingChemicalHistory")}</li>
        <li>{t("colorMissingStrandTest")}</li>
        <li>{t("colorMissingDetermination")}</li>
      </ul>
      <p className="mt-2 text-sm">{t("colorMissingAuthorization")}</p>
    </Alert>
  );
}

// Requested explicitly: the difference between a candidate skill, an
// approved professional plan, and an execution must be reportable, not
// just internally understood. Rendered once, near the candidate list.
function VocabularyNote({ t }: { t: (key: PbStringKey) => string }) {
  return (
    <Alert variant="info" title={t("vocabularyTitle")}>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        <li>{t("vocabularyCandidateSkill")}</li>
        <li>{t("vocabularyApprovedPlan")}</li>
        <li>{t("vocabularyExecution")}</li>
      </ul>
    </Alert>
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
  const { language } = useUiLanguage();
  const t = (key: PbStringKey) => pbTranslate(language, key);

  const clientState = useClientProfile(clientId);
  const { state, createCurrentState, createTargetState, confirmSnapshot } = useProfessionalBrainEvaluation(clientId);

  const [domains, setDomains] = useState<readonly ProfessionalBrainDomain[]>(["cut", "color"]);
  const [currentGlobal, setCurrentGlobal] = useState(UNSPECIFIED_GLOBAL_CUT_FACTS);
  const [currentColor, setCurrentColor] = useState(UNSPECIFIED_COLOR_FACTS);
  const [targetGlobal, setTargetGlobal] = useState(UNSPECIFIED_GLOBAL_CUT_FACTS);
  const [targetColor, setTargetColor] = useState(UNSPECIFIED_COLOR_FACTS);
  const [targetZone, setTargetZone] = useState<HeadZone>("nape");
  const [targetLengthIntent, setTargetLengthIntent] = useState<ZoneLengthIntent>("unspecified");
  const [targetWeightIntent, setTargetWeightIntent] = useState<ZoneWeightIntent>("unspecified");
  const [targetPerimeterRelationship, setTargetPerimeterRelationship] = useState<HairStatePerimeterRelationship>("unspecified");

  const [createCurrentState_, setCreateCurrentState_] = useState<ActionState>(IDLE);
  const [createTargetState_, setCreateTargetState_] = useState<ActionState>(IDLE);
  const [confirmCurrentState_, setConfirmCurrentState_] = useState<ActionState>(IDLE);
  const [confirmTargetState_, setConfirmTargetState_] = useState<ActionState>(IDLE);

  const [newRoundActive, setNewRoundActive] = useState(false);
  const [newCurrentDraft, setNewCurrentDraft] = useState<HairStateSnapshotRecord | null>(null);
  const [newTargetDraft, setNewTargetDraft] = useState<HairStateSnapshotRecord | null>(null);
  const roundInProgress = newRoundActive && !(newCurrentDraft?.status === "CONFIRMED" && newTargetDraft?.status === "CONFIRMED");

  function handleOutcome(outcome: ProfessionalBrainActionOutcome, setter: (s: ActionState) => void) {
    setter(outcome.ok ? IDLE : { busy: false, error: outcome.message });
  }

  function resetTargetForm() {
    setTargetGlobal(UNSPECIFIED_GLOBAL_CUT_FACTS);
    setTargetColor(UNSPECIFIED_COLOR_FACTS);
    setTargetLengthIntent("unspecified");
    setTargetWeightIntent("unspecified");
    setTargetPerimeterRelationship("unspecified");
  }

  function startNewEvaluation() {
    setNewRoundActive(true);
    setNewCurrentDraft(null);
    setNewTargetDraft(null);
    setDomains(["cut", "color"]);
    setCurrentGlobal(UNSPECIFIED_GLOBAL_CUT_FACTS);
    setCurrentColor(UNSPECIFIED_COLOR_FACTS);
    resetTargetForm();
    setCreateCurrentState_(IDLE);
    setCreateTargetState_(IDLE);
    setConfirmCurrentState_(IDLE);
    setConfirmTargetState_(IDLE);
  }

  function cancelNewEvaluation() {
    setNewRoundActive(false);
    setNewCurrentDraft(null);
    setNewTargetDraft(null);
  }

  async function handleCreateCurrent() {
    if (domains.length === 0) return;
    setCreateCurrentState_({ busy: true, error: null });
    const outcome = await createCurrentState(buildCurrentStatePayload(currentGlobal, currentColor, domains));
    handleOutcome(outcome, setCreateCurrentState_);
    if (outcome.ok && roundInProgress) setNewCurrentDraft(outcome.snapshot);
  }
  async function handleCreateTarget() {
    setCreateTargetState_({ busy: true, error: null });
    const nothingSet = targetLengthIntent === "unspecified" && targetWeightIntent === "unspecified" && targetPerimeterRelationship === "unspecified";
    const zoneIntent: TargetZoneIntentInput | null = nothingSet
      ? null
      : { zone: targetZone, lengthIntent: targetLengthIntent, weightIntent: targetWeightIntent, perimeterRelationship: targetPerimeterRelationship };
    const outcome = await createTargetState(buildTargetStatePayload(targetGlobal, targetColor, zoneIntent));
    handleOutcome(outcome, setCreateTargetState_);
    if (outcome.ok && roundInProgress) setNewTargetDraft(outcome.snapshot);
  }
  async function handleConfirmCurrent(snapshotId: string, expected: string | null) {
    setConfirmCurrentState_({ busy: true, error: null });
    const outcome = await confirmSnapshot(snapshotId, expected);
    handleOutcome(outcome, setConfirmCurrentState_);
    if (outcome.ok && roundInProgress) setNewCurrentDraft(outcome.snapshot);
  }
  async function handleConfirmTarget(snapshotId: string, expected: string | null) {
    setConfirmTargetState_({ busy: true, error: null });
    const outcome = await confirmSnapshot(snapshotId, expected);
    handleOutcome(outcome, setConfirmTargetState_);
    if (outcome.ok && roundInProgress) setNewTargetDraft(outcome.snapshot);
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

  const { currentSnapshot, targetSnapshot, evaluation, stylingGap } = state;
  const effectiveCurrent = roundInProgress ? newCurrentDraft : currentSnapshot;
  const effectiveTarget = roundInProgress ? newTargetDraft : targetSnapshot;
  const groupedCandidates = evaluation ? groupCandidateMatchesBySkill(evaluation.candidateMatches) : [];
  // Once a CURRENT snapshot exists (DRAFT or CONFIRMED) for this round, its
  // OWN recorded intent is authoritative -- coherent across a page refresh
  // and never retroactively reinterpreted by whatever the checkboxes above
  // happen to show. Only before that (still choosing) does the local
  // `domains` selection drive anything.
  const activeDomains = effectiveCurrent ? resolveClientDomainIntent(effectiveCurrent) : domains;
  const showCutFields = activeDomains.includes("cut");
  const showColorFields = activeDomains.includes("color");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/clients/${clientId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("backToPrefix")} {client.fullName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{t("pageTitle")}</h1>
      </div>

      <Alert variant="info" title={t("flowStopsTitle")}>
        {t("flowStopsBody")}
      </Alert>

      {roundInProgress ? (
        <Alert variant="info" title={t("newRoundTitle")}>
          {t("newRoundBody")}{" "}
          <button type="button" className="underline" onClick={cancelNewEvaluation}>
            {t("cancelAndGoBack")}
          </button>
          .
        </Alert>
      ) : null}

      <DomainSelectionFields value={activeDomains} onChange={setDomains} editable={!effectiveCurrent} t={t} />

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{t("currentStateHeading")}</h2>
        {!effectiveCurrent ? (
          <>
            {showCutFields ? <GlobalCutFactsFields value={currentGlobal} onChange={setCurrentGlobal} disabled={createCurrentState_.busy} t={t} /> : null}
            {showColorFields ? <ColorFactsFields value={currentColor} onChange={setCurrentColor} disabled={createCurrentState_.busy} t={t} /> : null}
            {!showCutFields && !showColorFields ? <p className="text-sm text-muted">{t("noFieldsForSelectedDomains")}</p> : null}
            <p className="text-xs text-muted">{t("zoneFactsHelpNote")}</p>
            <div>
              <Button type="button" onClick={handleCreateCurrent} loading={createCurrentState_.busy} disabled={domains.length === 0}>
                {t("createCurrentButton")}
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
            <SnapshotSummary snapshot={effectiveCurrent} activeDomains={activeDomains} t={t} />
            {effectiveCurrent.status === "DRAFT" ? (
              <div>
                <Button
                  type="button"
                  onClick={() => handleConfirmCurrent(effectiveCurrent.id, getExpectedConfirmedSnapshotId(currentSnapshot))}
                  loading={confirmCurrentState_.busy}
                >
                  {t("confirmCurrentButton")}
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

      {effectiveCurrent?.status === "CONFIRMED" ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t("targetStateHeading")}</h2>
          {!effectiveTarget ? (
            <>
              {showCutFields ? <GlobalCutFactsFields value={targetGlobal} onChange={setTargetGlobal} disabled={createTargetState_.busy} t={t} /> : null}
              {showColorFields ? <ColorFactsFields value={targetColor} onChange={setTargetColor} disabled={createTargetState_.busy} t={t} /> : null}
              {showCutFields ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Select label={t("zoneLabel")} disabled={createTargetState_.busy} value={targetZone} onChange={(e) => setTargetZone(e.target.value as HeadZone)}>
                      {ZONE_OPTIONS.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </Select>
                    <Select label={t("lengthIntentLabel")} disabled={createTargetState_.busy} value={targetLengthIntent} onChange={(e) => setTargetLengthIntent(e.target.value as ZoneLengthIntent)}>
                      {ZONE_LENGTH_INTENT_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                    <Select label={t("weightIntentLabel")} disabled={createTargetState_.busy} value={targetWeightIntent} onChange={(e) => setTargetWeightIntent(e.target.value as ZoneWeightIntent)}>
                      {ZONE_WEIGHT_INTENT_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label={t("perimeterRelationshipLabel")}
                      disabled={createTargetState_.busy}
                      value={targetPerimeterRelationship}
                      onChange={(e) => setTargetPerimeterRelationship(e.target.value as HairStatePerimeterRelationship)}
                    >
                      {PERIMETER_RELATIONSHIP_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <p className="text-xs text-muted">{t("oneLengthHint")}</p>
                </>
              ) : null}
              {!showCutFields && !showColorFields ? <p className="text-sm text-muted">{t("noFieldsForSelectedDomains")}</p> : null}
              <p className="text-xs text-muted">{t("zoneFactsHelpNote")}</p>
              <div>
                <Button type="button" onClick={handleCreateTarget} loading={createTargetState_.busy}>
                  {t("createTargetButton")}
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
              <SnapshotSummary snapshot={effectiveTarget} activeDomains={activeDomains} t={t} />
              {effectiveTarget.status === "DRAFT" ? (
                <div>
                  <Button
                    type="button"
                    onClick={() => handleConfirmTarget(effectiveTarget.id, getExpectedConfirmedSnapshotId(targetSnapshot))}
                    loading={confirmTargetState_.busy}
                  >
                    {t("confirmTargetButton")}
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

      {(evaluation || stylingGap) && !roundInProgress ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{t("deltaHeading")}</h2>
          {stylingGap ? (
            <StylingGapNotice gap={stylingGap} t={t} />
          ) : evaluation ? (
            <>
              <DeltaTable entries={evaluation.delta.entries} />
              <CandidateSkillList groups={groupedCandidates} t={t} />
              <VocabularyNote t={t} />
              {hasColorCandidate(evaluation.candidateMatches) ? <ColorEvaluationDisclosure t={t} /> : null}
              <UnresolvedDeltaList entries={evaluation.unresolvedDeltas} language={language} t={t} />
            </>
          ) : null}
          <div>
            <Button type="button" variant="secondary" onClick={startNewEvaluation}>
              {t("startNewEvaluationButton")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
