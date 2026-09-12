// Teach the AI, Professional Learning Evidence surface (Stage 8.5L3).
// Pulled out of teach-ai-panel.tsx for the same reason
// teach-ai-panel-logic.ts already is: no .test.tsx convention exists in
// this repo (analysis-original-photo-logic.ts), so anything worth a real
// unit test lives in a plain .ts module the component only calls into.
//
// FORBIDDEN-LANGUAGE AUDIT (task Part 22/45): every user-visible string
// this module or teach-ai-panel.tsx produces for the learning-evidence
// surface is listed here, once, so a single read proves none of them
// claims the system "learned", "understood", "mastered", or "added to
// professional knowledge" anything -- see LEARNING_EVIDENCE_STATUS_TEXT
// below, the only place these strings are defined.

export interface LearningEvidenceSummary {
  id: string;
  evidenceType: string;
  title: string | null;
  vertical: string;
  status: string;
  createdAt: string;
}

// One id per logical submit action (a click, not a byte range) --
// reused verbatim as the request's own submissionId so a double-click or
// a browser/network retry of the SAME action is recognized server-side
// (professional-learning-evidence-repository.ts's own submissionId
// idempotency) instead of creating a duplicate evidence row.
export function generateLearningEvidenceSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `learning-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface LearningEvidenceUploadMeta {
  submissionId: string;
  title?: string;
  vertical?: string;
}

export function buildLearningEvidenceImageFormData(file: File, meta: LearningEvidenceUploadMeta, evidenceType?: "IMAGE" | "DIAGRAM"): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("submissionId", meta.submissionId);
  if (evidenceType) form.append("evidenceType", evidenceType);
  if (meta.title) form.append("title", meta.title);
  if (meta.vertical) form.append("vertical", meta.vertical);
  return form;
}

export function buildLearningEvidenceImageSetFormData(files: readonly File[], meta: LearningEvidenceUploadMeta): FormData {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  form.append("submissionId", meta.submissionId);
  if (meta.title) form.append("title", meta.title);
  if (meta.vertical) form.append("vertical", meta.vertical);
  return form;
}

export function buildLearningEvidenceVideoFormData(file: File, meta: LearningEvidenceUploadMeta): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("submissionId", meta.submissionId);
  if (meta.title) form.append("title", meta.title);
  if (meta.vertical) form.append("vertical", meta.vertical);
  return form;
}

// Task Part 27: "Do NOT buffer 1GB+ files through Next.js/Railway
// memory" -- this is the ONE client-side gate that keeps an obviously
// oversized file from ever being sent at all, matching the server's own
// MAX_LEARNING_VIDEO_BYTES (learning-evidence-video-upload.ts) exactly.
// A file at or under this limit can still be rejected server-side (the
// server is the real authority -- this is only a courtesy that saves the
// professional a slow, doomed upload attempt).
export const CLIENT_MAX_LEARNING_VIDEO_BYTES = 200 * 1024 * 1024;

export function isVideoFileWithinClientSizeLimit(file: { size: number }): boolean {
  return file.size <= CLIENT_MAX_LEARNING_VIDEO_BYTES;
}

// Every user-visible outcome string this feature produces -- task Part 22:
// only ever "received/saved/uploaded", never "learned/understood/
// mastered/added to knowledge".
export const LEARNING_EVIDENCE_STATUS_TEXT = {
  savedText: "Salvat privat ca dovadă de învățare.",
  uploadedImage: "Fotografie încărcată ca dovadă de învățare privată.",
  uploadedImageSet: "Fotografiile au fost încărcate ca dovadă de învățare privată.",
  uploadedVideo: "Videoclipul a fost încărcat ca dovadă de învățare privată.",
  revoked: "Dovada a fost revocată -- nu va mai fi folosită pentru procesare viitoare.",
  genericFailure: "Materialul nu a putut fi salvat acum. Poți încerca din nou.",
  videoTooLarge: "Videoclipul depășește limita curentă pentru încărcare standard. Încărcarea fișierelor foarte mari nu este încă disponibilă.",
} as const;

export function isForbiddenLearningClaim(text: string): boolean {
  const lowered = text.toLocaleLowerCase();
  const forbidden = ["am învățat", "am înțeles", "am stăpânit", "adăugat la cunoștințele", "i learned", "i now know", "added to my professional knowledge", "skill learned"];
  return forbidden.some((phrase) => lowered.includes(phrase));
}
