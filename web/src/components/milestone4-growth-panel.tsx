"use client";

import { useState } from "react";

import type {
  AcademyCategory,
  AcademyLesson,
  ProductRecord,
  SupplierRecord,
  VideoLessonRecord
} from "@/lib/contracts";

type StatusTone = "ok" | "error" | "info";

export function Milestone4GrowthPanel() {
  const [categories, setCategories] = useState<AcademyCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [lessons, setLessons] = useState<AcademyLesson[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<AcademyLesson | null>(null);

  const [videoTopic, setVideoTopic] = useState("Color correction basics");
  const [videoLevel, setVideoLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [videoLesson, setVideoLesson] = useState<VideoLessonRecord | null>(null);

  const [marketCountry, setMarketCountry] = useState("RO");
  const [marketCity, setMarketCity] = useState("Bucharest");
  const [marketGoal, setMarketGoal] = useState("refresh");
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  const [shortlistTitle, setShortlistTitle] = useState("Localized supplier shortlist");
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadCategories() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/academy/categories", { method: "GET" });
      const payload = (await response.json()) as { categories?: AcademyCategory[]; error?: string };
      if (!response.ok || !payload.categories) {
        setStatus({ tone: "error", message: payload.error || "Failed to load categories." });
        return;
      }

      setCategories(payload.categories);
      if (!selectedCategoryId && payload.categories.length > 0) {
        setSelectedCategoryId(payload.categories[0].id);
      }
      setStatus({ tone: "ok", message: "Academy categories loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function loadLessons() {
    setBusy(true);
    setStatus(null);
    try {
      const query = selectedCategoryId ? `?categoryId=${encodeURIComponent(selectedCategoryId)}` : "";
      const response = await fetch(`/api/v1/academy/lessons${query}`, { method: "GET" });
      const payload = (await response.json()) as { lessons?: AcademyLesson[]; error?: string };
      if (!response.ok || !payload.lessons) {
        setStatus({ tone: "error", message: payload.error || "Failed to load lessons." });
        return;
      }

      setLessons(payload.lessons);
      setSelectedLesson(null);
      setStatus({ tone: "ok", message: "Lessons loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function loadLessonById(lessonId: string) {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/academy/lessons/${lessonId}`, { method: "GET" });
      const payload = (await response.json()) as { lesson?: AcademyLesson; error?: string };
      if (!response.ok || !payload.lesson) {
        setStatus({ tone: "error", message: payload.error || "Lesson not found." });
        return;
      }

      setSelectedLesson(payload.lesson);
      setStatus({ tone: "ok", message: "Lesson details loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function generateVideoLesson() {
    if (!videoTopic.trim()) {
      setStatus({ tone: "error", message: "Video topic is required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/video-lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: videoTopic, level: videoLevel, locale: "en" })
      });

      const payload = (await response.json()) as { videoLesson?: VideoLessonRecord; error?: string };
      if (!response.ok || !payload.videoLesson) {
        setStatus({ tone: "error", message: payload.error || "Video generation failed." });
        return;
      }

      setVideoLesson(payload.videoLesson);
      setStatus({ tone: "ok", message: "Video lesson generated." });
    } finally {
      setBusy(false);
    }
  }

  async function refreshVideoLesson() {
    if (!videoLesson) {
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/video-lessons/${videoLesson.id}`, { method: "GET" });
      const payload = (await response.json()) as { videoLesson?: VideoLessonRecord; error?: string };
      if (!response.ok || !payload.videoLesson) {
        setStatus({ tone: "error", message: payload.error || "Video lesson load failed." });
        return;
      }

      setVideoLesson(payload.videoLesson);
      setStatus({ tone: "ok", message: "Video lesson refreshed." });
    } finally {
      setBusy(false);
    }
  }

  async function searchMarketplace() {
    setBusy(true);
    setStatus(null);
    try {
      const query = `countryCode=${encodeURIComponent(marketCountry)}&city=${encodeURIComponent(marketCity)}&goal=${encodeURIComponent(marketGoal)}`;

      const [productsResponse, suppliersResponse] = await Promise.all([
        fetch(`/api/v1/products?${query}`, { method: "GET" }),
        fetch(`/api/v1/suppliers/recommended?${query}`, { method: "GET" })
      ]);

      const productsPayload = (await productsResponse.json()) as { products?: ProductRecord[]; error?: string };
      const suppliersPayload = (await suppliersResponse.json()) as { suppliers?: SupplierRecord[]; error?: string };

      if (!productsResponse.ok || !suppliersResponse.ok) {
        setStatus({
          tone: "error",
          message: productsPayload.error || suppliersPayload.error || "Marketplace search failed."
        });
        return;
      }

      setProducts(productsPayload.products ?? []);
      setSuppliers(suppliersPayload.suppliers ?? []);
      setStatus({ tone: "ok", message: "Marketplace data loaded." });
    } finally {
      setBusy(false);
    }
  }

  async function saveShortlist() {
    if (!shortlistTitle.trim()) {
      setStatus({ tone: "error", message: "Shortlist title is required." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/shortlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shortlistTitle,
          productIds: products.map((item) => item.id),
          supplierIds: suppliers.map((item) => item.id)
        })
      });

      const payload = (await response.json()) as { shortlist?: { id: string }; error?: string };
      if (!response.ok || !payload.shortlist) {
        setStatus({ tone: "error", message: payload.error || "Shortlist save failed." });
        return;
      }

      setStatus({ tone: "ok", message: `Shortlist saved (${payload.shortlist.id}).` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-next" id="milestone4">
      <div className="section-header-next">
        <h3>Milestone 4 - Academy, Video, Marketplace</h3>
        <span>Taxonomy + generation pipeline + localized suppliers</span>
      </div>

      <div className="milestone-panel-grid">
        <article className="milestone-card milestone-card-wide">
          <h4>1) Academy Taxonomy and Lessons</h4>
          <div className="inline-actions">
            <button type="button" onClick={loadCategories} disabled={busy}>
              Load categories
            </button>
            <select value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={loadLessons} disabled={busy}>
              Load lessons
            </button>
          </div>

          <div className="lesson-list">
            {lessons.length === 0 ? <p className="helper-text">No lessons loaded.</p> : null}
            {lessons.map((lesson) => (
              <div key={lesson.id} className="timeline-row">
                <strong>{lesson.title}</strong>
                <small>{lesson.summary}</small>
                <button type="button" onClick={() => void loadLessonById(lesson.id)} disabled={busy}>
                  Open details
                </button>
              </div>
            ))}
          </div>

          {selectedLesson ? (
            <div className="analysis-result-box">
              <p><strong>{selectedLesson.title}</strong></p>
              <p>{selectedLesson.summary}</p>
              <p><strong>Warnings</strong></p>
              <ul>
                {selectedLesson.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article className="milestone-card">
          <h4>2) Video Lesson Generation</h4>
          <div className="field-grid">
            <input value={videoTopic} onChange={(event) => setVideoTopic(event.target.value)} placeholder="Topic" />
            <select
              value={videoLevel}
              onChange={(event) =>
                setVideoLevel(event.target.value as "beginner" | "intermediate" | "advanced")
              }
            >
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
            </select>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={generateVideoLesson} disabled={busy}>
              Generate video lesson
            </button>
            <button type="button" onClick={refreshVideoLesson} disabled={busy || !videoLesson}>
              Refresh generated lesson
            </button>
          </div>

          {videoLesson ? (
            <div className="analysis-result-box">
              <p><strong>Status:</strong> {videoLesson.status}</p>
              <p><strong>Video URL:</strong> {videoLesson.videoUrl || "pending"}</p>
              <p><strong>Recommended lessons:</strong> {videoLesson.recommendedLessonIds.join(", ") || "none"}</p>
              <pre className="script-preview">{videoLesson.script}</pre>
            </div>
          ) : null}
        </article>

        <article className="milestone-card milestone-card-wide">
          <h4>3) Marketplace Localization</h4>
          <div className="field-grid field-grid-2">
            <input value={marketCountry} onChange={(event) => setMarketCountry(event.target.value)} placeholder="Country code" />
            <input value={marketCity} onChange={(event) => setMarketCity(event.target.value)} placeholder="City" />
            <select value={marketGoal} onChange={(event) => setMarketGoal(event.target.value)}>
              <option value="refresh">refresh</option>
              <option value="cover">cover</option>
              <option value="lighten">lighten</option>
              <option value="correct">correct</option>
              <option value="reshape">reshape</option>
              <option value="treat">treat</option>
            </select>
            <input
              value={shortlistTitle}
              onChange={(event) => setShortlistTitle(event.target.value)}
              placeholder="Shortlist title"
            />
          </div>

          <div className="inline-actions">
            <button type="button" onClick={searchMarketplace} disabled={busy}>
              Search localized marketplace
            </button>
            <button type="button" onClick={saveShortlist} disabled={busy || (products.length === 0 && suppliers.length === 0)}>
              Save shortlist
            </button>
          </div>

          <div className="milestone-panel-grid marketplace-grid">
            <div className="milestone-card">
              <h5>Products</h5>
              {products.length === 0 ? <p className="helper-text">No products loaded.</p> : null}
              {products.map((product) => (
                <div key={product.id} className="timeline-row">
                  <strong>{product.name}</strong>
                  <small>{product.brand} - {product.category}</small>
                </div>
              ))}
            </div>
            <div className="milestone-card">
              <h5>Recommended Suppliers</h5>
              {suppliers.length === 0 ? <p className="helper-text">No suppliers loaded.</p> : null}
              {suppliers.map((supplier) => (
                <div key={supplier.id} className="timeline-row">
                  <strong>{supplier.name}</strong>
                  <small>{supplier.countryCode}/{supplier.city} - rating {supplier.rating.toFixed(1)}</small>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>

      {status ? <p className={`status-line status-${status.tone}`}>{status.message}</p> : null}
    </section>
  );
}
