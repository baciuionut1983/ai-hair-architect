"use client";

import { ArrowLeft, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AnalysisOriginalPhoto, ColorPlanView, TechnicalCutPlanView, TreatmentPlanView } from "@/components/analysis";
import { Alert, Button, Card, ErrorState, Input, LoadingState, Select, Tabs, Textarea } from "@/components/ui";
import {
  DENSITY_OPTIONS,
  DESIRED_COLOR_RESULT_OPTIONS,
  FACE_SHAPE_OPTIONS,
  GOAL_OPTIONS,
  GRAY_PERCENTAGE_OPTIONS,
  GROWTH_PATTERN_OPTIONS,
  HAIR_CONDITION_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  HAIR_TEXTURE_OPTIONS,
  HAIR_TYPE_OPTIONS,
  HEAD_SHAPE_OPTIONS,
  POROSITY_OPTIONS,
  SCALP_CONDITION_OPTIONS,
  TARGET_SHAPE_OPTIONS,
  TREATMENT_GOAL_DETAIL_OPTIONS
} from "@/lib/analysis-field-options";
import type {
  AnalysisGoal,
  AnalysisResponse,
  ConsultationCreateRequest,
  DensityLevel,
  HairType,
  PorosityLevel
} from "@/lib/contracts";

import {
  type AnalysisFormValues,
  buildAnalysisRequest,
  canStartAnalysis,
  collectClarificationAnswers,
  DEFAULT_ANALYSIS_FORM,
  getRelevantFieldGroup
} from "./analysis-form-logic";
import { useClientProfile } from "../../use-client-profile";

type WizardPhase = "form" | "submitted";
type EntryMode = "manual" | "photo";
type PhotoStep = "pick" | "consent" | "review";

const ENTRY_MODE_TABS = [
  { value: "manual", label: "Manual" },
  { value: "photo", label: "From a photo" }
];

interface PhotoAnalysisPayload {
  hairType?: string | null;
  density?: string | null;
  porosity?: string | null;
  faceShape?: string | null;
  headShape?: string | null;
  hairLength?: string | null;
  hairTexture?: string | null;
  hairCondition?: string | null;
  growthPattern?: string | null;
  targetShape?: string | null;
}

export default function NewAnalysisPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const clientState = useClientProfile(clientId);

  const [wizardPhase, setWizardPhase] = useState<WizardPhase>("form");
  const [entryMode, setEntryMode] = useState<EntryMode>("manual");
  const [form, setForm] = useState<AnalysisFormValues>(DEFAULT_ANALYSIS_FORM);
  const [startError, setStartError] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);

  const [clarificationInputs, setClarificationInputs] = useState<string[]>([]);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const [clarifyBusy, setClarifyBusy] = useState(false);

  const [consultationSummary, setConsultationSummary] = useState("");
  const [consultationSteps, setConsultationSteps] = useState("");
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [consultationBusy, setConsultationBusy] = useState(false);
  const [consultationSaved, setConsultationSaved] = useState(false);

  const [photoStep, setPhotoStep] = useState<PhotoStep>("pick");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [assetId, setAssetId] = useState<string | null>(null);

  // Local preview only, before the file is uploaded -- never confused with
  // the persisted asset: once assetId exists, AnalysisOriginalPhoto (backed
  // by /api/v1/image-assets/{assetId}/content) takes over as the source of
  // truth. Revokes the previous object URL whenever selectedFile changes or
  // this component unmounts, so no blob URL is ever leaked.
  useEffect(() => {
    if (!selectedFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing with an external resource (the object URL), not deriving state; no async boundary exists to defer this past (see milestone2-analysis-panel.tsx for the same precedent)
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  const [consentChecked, setConsentChecked] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [photoPayload, setPhotoPayload] = useState<PhotoAnalysisPayload | null>(null);

  const [photoGoal, setPhotoGoal] = useState<AnalysisGoal | "">("");
  const [photoHairType, setPhotoHairType] = useState<HairType | "">("");
  const [photoDensity, setPhotoDensity] = useState<DensityLevel | "">("");
  const [photoPorosity, setPhotoPorosity] = useState<PorosityLevel | "">("");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);

  async function handleUploadPhoto() {
    if (!selectedFile) {
      setUploadError("Choose a photo first.");
      return;
    }

    setUploadBusy(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.set("clientId", clientId);
      formData.append("files", selectedFile);

      const response = await fetch("/api/v1/uploads", { method: "POST", body: formData });
      const data = (await response.json()) as { assets?: { assetId: string }[]; error?: string };

      if (!response.ok || !data.assets?.[0]) {
        setUploadError(data.error || "Could not upload the photo. Please try again.");
        return;
      }

      setAssetId(data.assets[0].assetId);
      setPhotoStep("consent");
    } catch {
      setUploadError("Could not upload the photo. Please try again.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleRequestAiAnalysis() {
    if (!assetId || !consentChecked) return;

    setRequestBusy(true);
    setRequestError(null);
    try {
      const response = await fetch(`/api/v1/image-analyses/${assetId}/request-ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true })
      });
      const data = (await response.json()) as {
        analysis?: { analysisPayload?: PhotoAnalysisPayload };
        error?: string;
      };

      if (!response.ok || !data.analysis) {
        setRequestError(data.error || "Could not request the AI analysis. Please try again.");
        return;
      }

      const payload = data.analysis.analysisPayload ?? {};
      setPhotoPayload(payload);
      setPhotoDensity(isDensity(payload.density) ? payload.density : "");
      setPhotoPorosity(isPorosity(payload.porosity) ? payload.porosity : "");
      setPhotoStep("review");
    } catch {
      setRequestError("Could not request the AI analysis. Please try again.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleFinalizePhotoAnalysis() {
    if (!assetId || !photoGoal || !photoHairType) {
      setFinalizeError("Select a goal and a hair type before continuing.");
      return;
    }

    setFinalizeBusy(true);
    setFinalizeError(null);
    try {
      const body: Record<string, unknown> = {
        corrections: {},
        finalizeToM8: true,
        goal: photoGoal,
        hairType: photoHairType
      };
      if (photoDensity) body.density = photoDensity;
      if (photoPorosity) body.porosity = photoPorosity;

      const response = await fetch(`/api/v1/image-analyses/${assetId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { result?: AnalysisResponse; error?: string; message?: string };

      if (!response.ok || !data.result) {
        setFinalizeError(data.message || data.error || "Could not finalize the analysis. Please try again.");
        return;
      }

      setAnalysisResult(data.result);
      setClarificationInputs(data.result.followUpQuestions.map(() => ""));
      setConsultationSummary(data.result.recommendations.join(" "));
      setWizardPhase("submitted");
    } catch {
      setFinalizeError("Could not finalize the analysis. Please try again.");
    } finally {
      setFinalizeBusy(false);
    }
  }

  function handleGoalChange(goal: AnalysisGoal | "") {
    setForm({
      ...DEFAULT_ANALYSIS_FORM,
      goal,
      hairType: form.hairType,
      density: form.density,
      porosity: form.porosity
    });
  }

  async function handleStartAnalysis() {
    const payload = buildAnalysisRequest(clientId, form);
    if (!payload) {
      setStartError("Please select a goal.");
      return;
    }

    setStartBusy(true);
    setStartError(null);
    try {
      const response = await fetch("/api/v1/analysis/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as AnalysisResponse & { error?: string };
      if (!response.ok) {
        setStartError(data.error || "Could not start the analysis. Please try again.");
        return;
      }

      setAnalysisResult(data);
      setClarificationInputs(data.followUpQuestions.map(() => ""));
      setConsultationSummary(data.recommendations.join(" "));
      setWizardPhase("submitted");
    } catch {
      setStartError("Could not start the analysis. Please try again.");
    } finally {
      setStartBusy(false);
    }
  }

  async function handleSubmitClarifications() {
    if (!analysisResult) return;

    const answers = collectClarificationAnswers(clarificationInputs);
    if (answers.length === 0) {
      setClarifyError("Provide at least one clarification answer.");
      return;
    }

    setClarifyBusy(true);
    setClarifyError(null);
    try {
      const response = await fetch(`/api/v1/analysis/${analysisResult.analysisId}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers })
      });

      const data = (await response.json()) as AnalysisResponse & { error?: string };
      if (!response.ok) {
        setClarifyError(data.error || "Could not submit clarifications. Please try again.");
        return;
      }

      setAnalysisResult(data);
      setClarificationInputs(data.followUpQuestions.map(() => ""));
    } catch {
      setClarifyError("Could not submit clarifications. Please try again.");
    } finally {
      setClarifyBusy(false);
    }
  }

  async function handleSaveConsultation() {
    if (!analysisResult || analysisResult.phase !== "ready") return;

    const summary = consultationSummary.trim();
    if (!summary) {
      setConsultationError("Consultation summary is required.");
      return;
    }

    const payload: ConsultationCreateRequest = {
      clientId,
      analysisId: analysisResult.analysisId,
      summary,
      nextSteps: consultationSteps
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    };

    setConsultationBusy(true);
    setConsultationError(null);
    try {
      const response = await fetch("/api/v1/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setConsultationError(data.error || "Could not save the consultation. Please try again.");
        return;
      }

      setConsultationSaved(true);
    } catch {
      setConsultationError("Could not save the consultation. Please try again.");
    } finally {
      setConsultationBusy(false);
    }
  }

  function handleStartNewAnalysis() {
    setWizardPhase("form");
    setEntryMode("manual");
    setForm(DEFAULT_ANALYSIS_FORM);
    setStartError(null);
    setAnalysisResult(null);
    setClarificationInputs([]);
    setClarifyError(null);
    setConsultationSummary("");
    setConsultationSteps("");
    setConsultationError(null);
    setConsultationSaved(false);

    setPhotoStep("pick");
    setSelectedFile(null);
    setUploadError(null);
    setAssetId(null);
    setConsentChecked(false);
    setRequestError(null);
    setPhotoPayload(null);
    setPhotoGoal("");
    setPhotoHairType("");
    setPhotoDensity("");
    setPhotoPorosity("");
    setFinalizeError(null);
  }

  if (clientState.status === "loading") {
    return <LoadingState label="Loading client..." />;
  }

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

  const { client } = clientState;
  const fieldGroup = getRelevantFieldGroup(form.goal);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {client.fullName}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">New AI analysis</h1>
        </div>
        {wizardPhase === "submitted" ? (
          <Button type="button" variant="secondary" onClick={handleStartNewAnalysis}>
            Start a new analysis
          </Button>
        ) : null}
      </div>

      {wizardPhase === "form" ? (
        <Tabs items={ENTRY_MODE_TABS} value={entryMode} onChange={(value) => setEntryMode(value as EntryMode)} />
      ) : null}

      {wizardPhase === "form" && entryMode === "manual" ? (
        <Card className="flex flex-col gap-4">
          <Select
            label="Goal"
            value={form.goal}
            onChange={(event) => handleGoalChange(event.target.value as AnalysisGoal | "")}
          >
            <option value="">Select a goal...</option>
            {GOAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Hair type"
              value={form.hairType}
              onChange={(event) => setForm((prev) => ({ ...prev, hairType: event.target.value as typeof form.hairType }))}
            >
              {HAIR_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label="Density"
              value={form.density}
              onChange={(event) => setForm((prev) => ({ ...prev, density: event.target.value as typeof form.density }))}
            >
              {DENSITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label="Porosity"
              value={form.porosity}
              onChange={(event) => setForm((prev) => ({ ...prev, porosity: event.target.value as typeof form.porosity }))}
            >
              {POROSITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {fieldGroup === "cut" ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <p className="text-xs text-muted">Optional details to refine the haircut plan</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <OptionalSelect label="Face shape" value={form.faceShape} options={FACE_SHAPE_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, faceShape: value }))} />
                <OptionalSelect label="Head shape" value={form.headShape} options={HEAD_SHAPE_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, headShape: value }))} />
                <OptionalSelect label="Hair length" value={form.hairLength} options={HAIR_LENGTH_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, hairLength: value }))} />
                <OptionalSelect label="Hair texture" value={form.hairTexture} options={HAIR_TEXTURE_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, hairTexture: value }))} />
                <OptionalSelect label="Hair condition" value={form.hairCondition} options={HAIR_CONDITION_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, hairCondition: value }))} />
                <OptionalSelect label="Growth pattern" value={form.growthPattern} options={GROWTH_PATTERN_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, growthPattern: value }))} />
                <OptionalSelect label="Target shape" value={form.targetShape} options={TARGET_SHAPE_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, targetShape: value }))} />
              </div>
            </div>
          ) : null}

          {fieldGroup === "color" ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <p className="text-xs text-muted">Optional details to refine the color plan</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <OptionalSelect label="Desired color result" value={form.desiredColorResult} options={DESIRED_COLOR_RESULT_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, desiredColorResult: value }))} />
                <OptionalSelect label="Gray percentage" value={form.grayPercentage} options={GRAY_PERCENTAGE_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, grayPercentage: value }))} />
                <OptionalSelect label="Hair condition" value={form.hairCondition} options={HAIR_CONDITION_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, hairCondition: value }))} />
              </div>
            </div>
          ) : null}

          {fieldGroup === "treatment" ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <p className="text-xs text-muted">Optional details to refine the treatment plan</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <OptionalSelect label="Treatment goal" value={form.treatmentGoalDetail} options={TREATMENT_GOAL_DETAIL_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, treatmentGoalDetail: value }))} />
                <OptionalSelect label="Scalp condition" value={form.scalpCondition} options={SCALP_CONDITION_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, scalpCondition: value }))} />
                <OptionalSelect label="Hair condition" value={form.hairCondition} options={HAIR_CONDITION_OPTIONS}
                  onChange={(value) => setForm((prev) => ({ ...prev, hairCondition: value }))} />
              </div>
            </div>
          ) : null}

          {fieldGroup === "none" && form.goal !== "" ? (
            <Alert variant="info">
              No specific haircut, color, or treatment plan is generated for this goal on its own. The analysis will
              still return general recommendations.
            </Alert>
          ) : null}

          {startError ? <Alert variant="error">{startError}</Alert> : null}

          <Button type="button" onClick={handleStartAnalysis} loading={startBusy} disabled={!canStartAnalysis(form)}>
            Start analysis
          </Button>
        </Card>
      ) : null}

      {wizardPhase === "form" && entryMode === "photo" ? (
        <Card className="flex flex-col gap-4">
          {photoStep === "pick" ? (
            <>
              <p className="text-sm text-muted">
                Choose a photo of the client&apos;s hair. It will be analyzed by AI once you confirm consent on the
                next step.
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="text-sm text-foreground"
              />
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob preview of a not-yet-uploaded File, never a build-time-known asset
                <img
                  src={previewUrl}
                  alt="Selected photo preview"
                  className="w-full max-h-[420px] rounded-lg object-cover"
                />
              ) : null}
              {uploadError ? <Alert variant="error">{uploadError}</Alert> : null}
              <Button type="button" onClick={handleUploadPhoto} loading={uploadBusy} disabled={!selectedFile}>
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                Upload photo
              </Button>
            </>
          ) : null}

          {photoStep === "consent" ? (
            <>
              <AnalysisOriginalPhoto imageAssetId={assetId} />
              <p className="text-sm text-foreground">Photo uploaded. AI analysis requires explicit consent.</p>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(event) => setConsentChecked(event.target.checked)}
                  className="mt-1"
                />
                I have the client&apos;s consent to send this photo to an external AI provider for analysis.
              </label>
              {requestError ? <Alert variant="error">{requestError}</Alert> : null}
              <Button type="button" onClick={handleRequestAiAnalysis} loading={requestBusy} disabled={!consentChecked}>
                Request AI analysis
              </Button>
            </>
          ) : null}

          {photoStep === "review" && photoPayload ? (
            <>
              <AnalysisOriginalPhoto imageAssetId={assetId} />
              <h2 className="text-sm font-semibold text-foreground">What the AI detected</h2>
              <ul className="list-inside list-disc text-sm text-muted">
                {photoPayload.hairType ? <li>Hair texture: {photoPayload.hairType}</li> : null}
                {photoPayload.faceShape ? <li>Face shape: {photoPayload.faceShape}</li> : null}
                {photoPayload.headShape ? <li>Head shape: {photoPayload.headShape}</li> : null}
                {photoPayload.hairLength ? <li>Hair length: {photoPayload.hairLength}</li> : null}
                {photoPayload.hairCondition ? <li>Hair condition: {photoPayload.hairCondition}</li> : null}
                {photoPayload.growthPattern ? <li>Growth pattern: {photoPayload.growthPattern}</li> : null}
                {photoPayload.targetShape ? <li>Target shape: {photoPayload.targetShape}</li> : null}
              </ul>

              <p className="text-xs text-muted">
                A few details the AI can&apos;t determine from a photo alone -- confirm them to continue.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label="Goal"
                  value={photoGoal}
                  onChange={(event) => setPhotoGoal(event.target.value as AnalysisGoal | "")}
                >
                  <option value="">Select a goal...</option>
                  {GOAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Hair type"
                  value={photoHairType}
                  onChange={(event) => setPhotoHairType(event.target.value as HairType | "")}
                >
                  <option value="">Select a hair type...</option>
                  {HAIR_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Density"
                  value={photoDensity}
                  onChange={(event) => setPhotoDensity(event.target.value as DensityLevel | "")}
                >
                  <option value="">Select density...</option>
                  {DENSITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Porosity"
                  value={photoPorosity}
                  onChange={(event) => setPhotoPorosity(event.target.value as PorosityLevel | "")}
                >
                  <option value="">Select porosity...</option>
                  {POROSITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              {finalizeError ? <Alert variant="error">{finalizeError}</Alert> : null}
              <Button
                type="button"
                onClick={handleFinalizePhotoAnalysis}
                loading={finalizeBusy}
                disabled={!photoGoal || !photoHairType || !photoDensity || !photoPorosity}
              >
                Continue to recommendations
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}

      {wizardPhase === "submitted" && analysisResult ? (
        <div className="flex flex-col gap-6">
          <Alert variant={analysisResult.phase === "ready" ? "success" : "info"}>
            {analysisResult.phase === "ready"
              ? "Analysis ready."
              : "More information is needed before this analysis is ready."}
          </Alert>

          <AnalysisOriginalPhoto imageAssetId={analysisResult.imageAssetId} />

          {analysisResult.phase === "pending_questions" && analysisResult.followUpQuestions.length > 0 ? (
            <Card className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-foreground">Clarification needed</h2>
              {analysisResult.followUpQuestions.map((question, index) => (
                <Input
                  key={`${question}-${index}`}
                  label={question}
                  value={clarificationInputs[index] ?? ""}
                  onChange={(event) => {
                    setClarificationInputs((prev) => {
                      const next = [...prev];
                      next[index] = event.target.value;
                      return next;
                    });
                  }}
                />
              ))}
              {clarifyError ? <Alert variant="error">{clarifyError}</Alert> : null}
              <Button type="button" onClick={handleSubmitClarifications} loading={clarifyBusy}>
                Submit clarifications
              </Button>
            </Card>
          ) : null}

          {analysisResult.recommendations.length > 0 || analysisResult.safetyNotes.length > 0 ? (
            <Card className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Summary</h2>
              {analysisResult.recommendations.length > 0 ? (
                <ul className="list-inside list-disc text-sm text-foreground">
                  {analysisResult.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {analysisResult.safetyNotes.length > 0 ? (
                <ul className="list-inside list-disc text-sm text-muted">
                  {analysisResult.safetyNotes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {analysisResult.technicalCutPlan ? <TechnicalCutPlanView plan={analysisResult.technicalCutPlan} /> : null}
          {analysisResult.colorPlan ? <ColorPlanView plan={analysisResult.colorPlan} /> : null}
          {analysisResult.treatmentPlan ? <TreatmentPlanView plan={analysisResult.treatmentPlan} /> : null}

          {analysisResult.phase === "ready" ? (
            <Card className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-foreground">Save as consultation</h2>
              {consultationSaved ? (
                <Alert variant="success">Consultation saved.</Alert>
              ) : (
                <>
                  <Textarea
                    label="Summary"
                    value={consultationSummary}
                    onChange={(event) => setConsultationSummary(event.target.value)}
                  />
                  <Textarea
                    label="Next steps (one per line)"
                    value={consultationSteps}
                    onChange={(event) => setConsultationSteps(event.target.value)}
                  />
                  {consultationError ? <Alert variant="error">{consultationError}</Alert> : null}
                  <Button type="button" onClick={handleSaveConsultation} loading={consultationBusy}>
                    Save consultation
                  </Button>
                </>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function isDensity(value: string | null | undefined): value is DensityLevel {
  return DENSITY_OPTIONS.some((option) => option.value === value);
}

function isPorosity(value: string | null | undefined): value is PorosityLevel {
  return POROSITY_OPTIONS.some((option) => option.value === value);
}

function OptionalSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T | "") => void;
}) {
  return (
    <Select label={label} value={value} onChange={(event) => onChange(event.target.value as T | "")}>
      <option value="">Not specified</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
