"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AnalysisRequest,
  AnalysisResultResponse,
  AnalysisResponse,
  ClientConsultationsResponse,
  ClientRecord,
  ConsultationCreateRequest,
  ConsultationRecord
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

interface AnalysisForm {
  clientId: string;
  goal: AnalysisRequest["goal"];
  hairType: AnalysisRequest["hairType"];
  density: AnalysisRequest["density"];
  porosity: AnalysisRequest["porosity"];
  faceShape: AnalysisRequest["faceShape"] | "";
  headShape: AnalysisRequest["headShape"] | "";
  hairLength: AnalysisRequest["hairLength"] | "";
  hairTexture: AnalysisRequest["hairTexture"] | "";
  hairCondition: AnalysisRequest["hairCondition"] | "";
  growthPattern: AnalysisRequest["growthPattern"] | "";
  targetShape: AnalysisRequest["targetShape"] | "";
}

const defaultAnalysisForm: AnalysisForm = {
  clientId: "",
  goal: "refresh",
  hairType: "medium",
  density: "medium",
  porosity: "medium",
  faceShape: "",
  headShape: "",
  hairLength: "",
  hairTexture: "",
  hairCondition: "",
  growthPattern: "",
  targetShape: ""
};

const LAST_ANALYSIS_ID_KEY = "aha-m8-last-analysis-id";

export function Milestone2AnalysisPanel() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [analysisForm, setAnalysisForm] = useState<AnalysisForm>(defaultAnalysisForm);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [clarificationInputs, setClarificationInputs] = useState<string[]>([]);
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([]);
  const [consultationSummary, setConsultationSummary] = useState("");
  const [consultationSteps, setConsultationSteps] = useState("Document formula\nSchedule follow-up");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedClientId = useMemo(() => analysisForm.clientId, [analysisForm.clientId]);

  const analysisPayload = useMemo(() => {
    const payload: AnalysisRequest = {
      clientId: analysisForm.clientId,
      goal: analysisForm.goal,
      hairType: analysisForm.hairType,
      density: analysisForm.density,
      porosity: analysisForm.porosity
    };

    if (analysisForm.faceShape) {
      payload.faceShape = analysisForm.faceShape;
    }
    if (analysisForm.headShape) {
      payload.headShape = analysisForm.headShape;
    }
    if (analysisForm.hairLength) {
      payload.hairLength = analysisForm.hairLength;
    }
    if (analysisForm.hairTexture) {
      payload.hairTexture = analysisForm.hairTexture;
    }
    if (analysisForm.hairCondition) {
      payload.hairCondition = analysisForm.hairCondition;
    }
    if (analysisForm.growthPattern) {
      payload.growthPattern = analysisForm.growthPattern;
    }
    if (analysisForm.targetShape) {
      payload.targetShape = analysisForm.targetShape;
    }

    return payload;
  }, [analysisForm]);

  const loadConsultations = useCallback(async (clientId: string) => {
    if (!clientId) {
      setConsultations([]);
      return;
    }

    const response = await fetch(`/api/v1/clients/${clientId}/consultations`, { method: "GET" });
    if (!response.ok) {
      setConsultations([]);
      return;
    }

    const payload = (await response.json()) as ClientConsultationsResponse;
    setConsultations(payload.consultations);
  }, []);

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/v1/clients", { method: "GET" });
    if (!response.ok) {
      setStatus({ tone: "error", message: "Sign in in M1 panel before using Milestone 2." });
      setClients([]);
      return;
    }

    const payload = (await response.json()) as { clients: ClientRecord[] };
    setClients(payload.clients);

    if (!analysisForm.clientId && payload.clients.length > 0) {
      setAnalysisForm((prev) => ({ ...prev, clientId: payload.clients[0].id }));
      await loadConsultations(payload.clients[0].id);
      return;
    }

    if (analysisForm.clientId) {
      await loadConsultations(analysisForm.clientId);
    }
  }, [analysisForm.clientId, loadConsultations]);

  useEffect(() => {
    const lastAnalysisId = typeof window === "undefined" ? null : window.localStorage.getItem(LAST_ANALYSIS_ID_KEY);
    if (!lastAnalysisId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadClients();
      return;
    }

    void (async () => {
      const response = await fetch(`/api/v1/analysis/${lastAnalysisId}/result`, { method: "GET" });
      if (!response.ok) {
        void loadClients();
        return;
      }

      const payload = (await response.json()) as AnalysisResultResponse;
      setAnalysisResult(payload);
      setAnalysisForm((prev) => ({
        ...prev,
        clientId: payload.clientId,
        goal: payload.goal,
        hairType: payload.hairType,
        density: payload.density,
        porosity: payload.porosity,
        faceShape: payload.faceShape ?? "",
        headShape: payload.headShape ?? "",
        hairLength: payload.hairLength ?? "",
        hairTexture: payload.hairTexture ?? "",
        hairCondition: payload.hairCondition ?? "",
        growthPattern: payload.growthPattern ?? "",
        targetShape: payload.targetShape ?? ""
      }));
      setClarificationInputs(payload.followUpQuestions.map(() => ""));
      setConsultationSummary(payload.recommendations.join(" "));
      await loadConsultations(payload.clientId);
      await loadClients();
    })();
  }, [loadClients, loadConsultations]);

  async function startAnalysis() {
    if (!analysisForm.clientId) {
      setStatus({ tone: "error", message: "Select a client first." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/analysis/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysisPayload)
      });

      const payload = (await response.json()) as AnalysisResponse | { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: (payload as { error?: string }).error || "Analysis start failed." });
        return;
      }

      const result = payload as AnalysisResponse;
      setAnalysisResult(result);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_ANALYSIS_ID_KEY, result.analysisId);
      }
      setClarificationInputs(result.followUpQuestions.map(() => ""));
      setConsultationSummary(result.recommendations.join(" "));
      setStatus({
        tone: "ok",
        message: result.phase === "ready" ? "Analysis ready." : "Clarification required before consultation."
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitClarifications() {
    if (!analysisResult) {
      return;
    }

    const answers = clarificationInputs.map((item) => item.trim()).filter(Boolean);
    if (answers.length === 0) {
      setStatus({ tone: "error", message: "Provide at least one clarification answer." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/analysis/${analysisResult.analysisId}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers })
      });

      const payload = (await response.json()) as AnalysisResponse | { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: (payload as { error?: string }).error || "Clarification failed." });
        return;
      }

      const updated = payload as AnalysisResponse;
      setAnalysisResult(updated);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_ANALYSIS_ID_KEY, updated.analysisId);
      }
      setClarificationInputs(updated.followUpQuestions.map(() => ""));
      setStatus({ tone: "ok", message: updated.phase === "ready" ? "Analysis is now ready." : "More clarification needed." });
    } finally {
      setBusy(false);
    }
  }

  async function saveConsultation() {
    if (!analysisResult || !analysisForm.clientId) {
      return;
    }

    if (analysisResult.phase !== "ready") {
      setStatus({ tone: "error", message: "Analysis must be ready before saving consultation." });
      return;
    }

    const payload: ConsultationCreateRequest = {
      clientId: analysisForm.clientId,
      analysisId: analysisResult.analysisId,
      summary: consultationSummary.trim(),
      nextSteps: consultationSteps
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    };

    if (!payload.summary) {
      setStatus({ tone: "error", message: "Consultation summary is required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus({ tone: "error", message: result.error || "Consultation save failed." });
        return;
      }

      await loadConsultations(analysisForm.clientId);
      setStatus({ tone: "ok", message: "Consultation saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-next" id="milestone2">
      <div className="section-header-next">
        <h3>Milestone 2 - Analysis and Consultation Core</h3>
        <span>Analysis lifecycle + clarifications + consultation history</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card milestone-card-wide">
          <h4>1) Analysis Start</h4>
          <div className="field-grid field-grid-2">
            <select
              value={analysisForm.clientId}
              onChange={(event) => setAnalysisForm((prev) => ({ ...prev, clientId: event.target.value }))}
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.fullName}
                </option>
              ))}
            </select>

            <select
              value={analysisForm.goal}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, goal: event.target.value as AnalysisRequest["goal"] }))
              }
            >
              <option value="refresh">refresh</option>
              <option value="cover">cover</option>
              <option value="lighten">lighten</option>
              <option value="correct">correct</option>
              <option value="reshape">reshape</option>
              <option value="treat">treat</option>
            </select>

            <select
              value={analysisForm.hairType}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, hairType: event.target.value as AnalysisRequest["hairType"] }))
              }
            >
              <option value="fine">fine</option>
              <option value="medium">medium</option>
              <option value="coarse">coarse</option>
            </select>

            <select
              value={analysisForm.density}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, density: event.target.value as AnalysisRequest["density"] }))
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>

            <select
              value={analysisForm.porosity}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, porosity: event.target.value as AnalysisRequest["porosity"] }))
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>

            <select
              value={analysisForm.faceShape}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, faceShape: event.target.value as AnalysisForm["faceShape"] }))
              }
            >
              <option value="">face shape (optional)</option>
              <option value="oval">oval</option>
              <option value="round">round</option>
              <option value="square">square</option>
              <option value="heart">heart</option>
              <option value="diamond">diamond</option>
              <option value="oblong">oblong</option>
            </select>

            <select
              value={analysisForm.headShape}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, headShape: event.target.value as AnalysisForm["headShape"] }))
              }
            >
              <option value="">head shape (optional)</option>
              <option value="balanced">balanced</option>
              <option value="flat_occipital">flat occipital</option>
              <option value="prominent_crown">prominent crown</option>
              <option value="wide_parietal">wide parietal</option>
              <option value="irregular_occipital">irregular occipital</option>
            </select>

            <select
              value={analysisForm.hairLength}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, hairLength: event.target.value as AnalysisForm["hairLength"] }))
              }
            >
              <option value="">hair length (optional)</option>
              <option value="pixie">pixie</option>
              <option value="short">short</option>
              <option value="medium">medium</option>
              <option value="long">long</option>
              <option value="extra_long">extra long</option>
            </select>

            <select
              value={analysisForm.hairTexture}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, hairTexture: event.target.value as AnalysisForm["hairTexture"] }))
              }
            >
              <option value="">hair texture (optional)</option>
              <option value="straight">straight</option>
              <option value="wavy">wavy</option>
              <option value="curly">curly</option>
              <option value="coily">coily</option>
            </select>

            <select
              value={analysisForm.hairCondition}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, hairCondition: event.target.value as AnalysisForm["hairCondition"] }))
              }
            >
              <option value="">hair condition (optional)</option>
              <option value="virgin_healthy">virgin healthy</option>
              <option value="chemically_treated">chemically treated</option>
              <option value="high_porosity_damaged">high porosity damaged</option>
              <option value="fragile_breakage">fragile breakage</option>
            </select>

            <select
              value={analysisForm.growthPattern}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, growthPattern: event.target.value as AnalysisForm["growthPattern"] }))
              }
            >
              <option value="">growth pattern (optional)</option>
              <option value="regular">regular</option>
              <option value="double_crown">double crown</option>
              <option value="front_cowlick">front cowlick</option>
              <option value="nape_whorl">nape whorl</option>
              <option value="strong_widow_peak">strong widow peak</option>
            </select>

            <select
              value={analysisForm.targetShape}
              onChange={(event) =>
                setAnalysisForm((prev) => ({ ...prev, targetShape: event.target.value as AnalysisForm["targetShape"] }))
              }
            >
              <option value="">target shape (optional)</option>
              <option value="precision_bob">precision bob</option>
              <option value="graduated_bob">graduated bob</option>
              <option value="long_layers">long layers</option>
              <option value="shag_mullet">shag mullet</option>
              <option value="pixie_crop">pixie crop</option>
              <option value="face_framing_cascade">face framing cascade</option>
              <option value="blunt_perimeter_texturized">blunt perimeter texturized</option>
            </select>
          </div>

          <div className="inline-actions">
            <button type="button" onClick={() => void loadClients()} disabled={busy}>
              Refresh clients
            </button>
            <button
              type="button"
              onClick={() => void loadConsultations(selectedClientId)}
              disabled={busy || !selectedClientId}
            >
              Refresh consultations
            </button>
            <button type="button" onClick={startAnalysis} disabled={busy}>
              Start analysis
            </button>
          </div>

          {analysisResult ? (
            <div className="analysis-result-box">
              <p><strong>Phase:</strong> {analysisResult.phase}</p>
              <p><strong>Confidence:</strong> {analysisResult.confidenceScore.toFixed(2)}</p>
              <p><strong>Clarification round:</strong> {analysisResult.clarificationRound}</p>

              {analysisResult.uncertaintyReasons.length > 0 ? (
                <>
                  <p><strong>Uncertainty reasons</strong></p>
                  <ul>
                    {analysisResult.uncertaintyReasons.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {analysisResult.followUpQuestions.length > 0 ? (
                <>
                  <p><strong>Follow-up questions</strong></p>
                  <div className="field-grid">
                    {analysisResult.followUpQuestions.map((question, index) => (
                      <label key={`${question}-${index}`} className="question-input">
                        <span>{question}</span>
                        <input
                          value={clarificationInputs[index] ?? ""}
                          onChange={(event) => {
                            setClarificationInputs((prev) => {
                              const next = [...prev];
                              next[index] = event.target.value;
                              return next;
                            });
                          }}
                          placeholder="Type answer"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={submitClarifications} disabled={busy}>
                      Submit clarifications
                    </button>
                  </div>
                </>
              ) : null}

              <p><strong>Recommendations</strong></p>
              <ul>
                {analysisResult.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <p><strong>Safety notes</strong></p>
              <ul>
                {analysisResult.safetyNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              {analysisResult.technicalCutPlan ? (
                <>
                  <p><strong>Technical cut plan</strong></p>
                  <p><strong>Structural technique:</strong> {analysisResult.technicalCutPlan.structuralTechnique}</p>
                  <p><strong>Cutting technique:</strong> {analysisResult.technicalCutPlan.cuttingTechnique}</p>
                  {analysisResult.technicalCutPlan.texturizingTechnique ? (
                    <p><strong>Texturizing technique:</strong> {analysisResult.technicalCutPlan.texturizingTechnique}</p>
                  ) : null}
                  <p><strong>Sectioning:</strong> {analysisResult.technicalCutPlan.sectioning}</p>
                  <p><strong>Elevation:</strong> {analysisResult.technicalCutPlan.elevation}</p>
                  <p><strong>Distribution:</strong> {analysisResult.technicalCutPlan.distribution}</p>
                  <p><strong>Guideline:</strong> {analysisResult.technicalCutPlan.guideline}</p>
                  <p><strong>Confidence:</strong> {analysisResult.technicalCutPlan.confidence.toFixed(2)}</p>
                  <p><strong>Version:</strong> {analysisResult.technicalCutPlan.version}</p>

                  <p><strong>Stylist explanation</strong></p>
                  <p>{analysisResult.technicalCutPlan.stylistExplanation}</p>

                  <p><strong>Client explanation</strong></p>
                  <p>{analysisResult.technicalCutPlan.clientExplanation}</p>

                  <p><strong>Professional reason</strong></p>
                  <p>{analysisResult.technicalCutPlan.professionalReason}</p>

                  {analysisResult.technicalCutPlan.notes?.length ? (
                    <>
                      <p><strong>Notes</strong></p>
                      <ul>
                        {analysisResult.technicalCutPlan.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  <p><strong>Cutting steps</strong></p>
                  <ol>
                    {analysisResult.technicalCutPlan.cuttingSteps.map((step) => (
                      <li key={`${step.stepNumber}-${step.zone}`}>
                        Step {step.stepNumber}: {step.zone} - {step.action} ({step.toolRequired})
                      </li>
                    ))}
                  </ol>

                  <p><strong>Warnings</strong></p>
                  <ul>
                    {analysisResult.technicalCutPlan.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p><strong>Contraindications</strong></p>
                  <ul>
                    {analysisResult.technicalCutPlan.contraindications.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p><strong>Assumptions</strong></p>
                  <ul>
                    {analysisResult.technicalCutPlan.assumptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p><strong>Missing data</strong></p>
                  <ul>
                    {analysisResult.technicalCutPlan.missingData.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p><strong>Stylist validation</strong></p>
                  <p>{analysisResult.technicalCutPlan.stylistValidationDisclaimer}</p>
                </>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="milestone-card">
          <h4>2) Consultation Composer</h4>
          <div className="field-grid">
            <textarea
              value={consultationSummary}
              onChange={(event) => setConsultationSummary(event.target.value)}
              placeholder="Consultation summary"
              rows={4}
            />
            <textarea
              value={consultationSteps}
              onChange={(event) => setConsultationSteps(event.target.value)}
              placeholder="One next step per line"
              rows={4}
            />
          </div>
          <div className="inline-actions">
            <button type="button" onClick={saveConsultation} disabled={busy || !analysisResult}>
              Save consultation
            </button>
          </div>
        </article>

        <article className="milestone-card">
          <h4>3) Consultation History</h4>
          <div className="client-list">
            {consultations.length === 0 ? <p className="helper-text">No consultations yet.</p> : null}
            {consultations.map((entry) => (
              <div key={entry.id} className="client-row column-row">
                <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                <p>{entry.summary}</p>
                {entry.nextSteps.length > 0 ? (
                  <ul>
                    {entry.nextSteps.map((step) => (
                      <li key={`${entry.id}-${step}`}>{step}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </div>

      {status ? (
        <p className={`status-line status-${status.tone}`}>
          {status.message}
        </p>
      ) : null}
    </section>
  );
}
