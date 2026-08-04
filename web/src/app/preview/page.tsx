"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  AnalysisGoal,
  AnalysisPreviewRequest,
  AnalysisPreviewResponse,
  DensityLevel,
  HairType,
  PorosityLevel
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

const defaultForm: AnalysisPreviewRequest = {
  goal: "refresh",
  hairType: "medium",
  density: "medium",
  porosity: "medium"
};

export default function GuestPreviewPage() {
  const [form, setForm] = useState<AnalysisPreviewRequest>(defaultForm);
  const [result, setResult] = useState<AnalysisPreviewResponse | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/analysis/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const payload = (await response.json()) as AnalysisPreviewResponse & { error?: string };
      if (!response.ok) {
        setResult(null);
        setStatus({ tone: "error", message: payload.error || "Preview failed." });
        return;
      }

      setResult(payload);
      setStatus({ tone: "ok", message: "Preview ready." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell-next">
      <header className="topbar-next">
        <div>
          <p className="eyebrow-next">Asistent AI pentru hairstyling profesional</p>
          <h1>Free Hair Preview</h1>
          <span className="preview-pill-next">No account needed</span>
        </div>
        <nav className="nav-next" aria-label="navigation">
          <Link href="/">Home</Link>
          <Link href="/#milestone1">Create free account</Link>
        </nav>
      </header>

      <section className="section-next" id="guest-preview">
        <div className="section-header-next">
          <h3>Try a free hair preview</h3>
          <span>No account, no photo, no cost</span>
        </div>

        <p className="helper-text">
          This is an orientative preview generated from the details you enter below. It is not a photo
          analysis, not an external AI diagnosis, and not a professional assessment. Create a free account
          for the full consultation experience, including photo-based analysis by a licensed professional
          workflow.
        </p>

        <div className="milestone-panel-grid">
          <article className="milestone-card milestone-card-wide">
            <h4>Tell us about your hair</h4>
            <div className="field-grid field-grid-2">
              <label>
                Goal
                <select
                  value={form.goal}
                  onChange={(event) => setForm((prev) => ({ ...prev, goal: event.target.value as AnalysisGoal }))}
                >
                  <option value="refresh">refresh</option>
                  <option value="cover">cover gray</option>
                  <option value="lighten">lighten</option>
                  <option value="correct">correct</option>
                  <option value="treat">treat</option>
                </select>
              </label>
              <label>
                Hair type
                <select
                  value={form.hairType}
                  onChange={(event) => setForm((prev) => ({ ...prev, hairType: event.target.value as HairType }))}
                >
                  <option value="fine">fine</option>
                  <option value="medium">medium</option>
                  <option value="coarse">coarse</option>
                </select>
              </label>
              <label>
                Density
                <select
                  value={form.density}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, density: event.target.value as DensityLevel }))
                  }
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <label>
                Porosity
                <select
                  value={form.porosity}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, porosity: event.target.value as PorosityLevel }))
                  }
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            </div>
            <div className="inline-actions">
              <button type="button" onClick={runPreview} disabled={busy}>
                {busy ? "Generating preview..." : "Get my free preview"}
              </button>
            </div>
          </article>

          {result ? (
            <article className="milestone-card milestone-card-wide">
              <h4>Your orientative preview</h4>
              <p className="helper-text">{result.disclaimer}</p>

              <p><strong>Recommendations</strong></p>
              <ul>
                {result.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              {result.safetyNotes.length > 0 ? (
                <>
                  <p><strong>Safety notes</strong></p>
                  <ul>
                    {result.safetyNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {result.followUpQuestions.length > 0 ? (
                <>
                  <p><strong>Worth thinking about</strong></p>
                  <ul>
                    {result.followUpQuestions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              <div className="inline-actions">
                <Link href="/#milestone1">
                  <button type="button">Create a free account for the full experience</button>
                </Link>
              </div>
            </article>
          ) : null}
        </div>

        {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
      </section>
    </div>
  );
}
