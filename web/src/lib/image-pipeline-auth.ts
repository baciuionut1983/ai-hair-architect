/**
 * M31 GO-2: documents and ISOLATES an unresolved authentication problem.
 * Nothing in this file is a working solution -- it exists so the problem
 * has exactly one, clearly-marked home instead of leaking into GO-4, and so
 * nobody reaches for `localStorage.getItem('token')` again out of habit.
 *
 * THE PROBLEM
 * -----------
 * Two independent, real authentication mechanisms exist side by side:
 *
 * 1. Cookie session (`aha_session`, httpOnly) + `getSession()` in
 *    milestone1-store.ts. Used by every route this application's new UI
 *    (M29/M30, and the manual analysis flow planned for M31 GO-3) calls:
 *    clients, consultations, appointments, analysis/start,
 *    analysis/[id]/clarify, analysis/[id]/result, etc.
 *
 * 2. Bearer token + `authenticateSessionUser()` in session-auth.ts, which
 *    looks the token up directly against the real Postgres `Session`
 *    table. This is the ONLY mechanism accepted by the image-upload and
 *    image-analysis pipeline: `POST /api/v1/uploads`, and every
 *    `/api/v1/image-analyses/[assetId]/*` route (GET, DELETE,
 *    request-ai-analysis, review). These are exactly the routes M31 GO-4
 *    (the photo-based analysis flow) will need to call.
 *
 * Both mechanisms are backed by the SAME session: `auth/login/route.ts`
 * creates one token and stores it in both places (`createSession` for the
 * in-memory/cookie path, `createPersistenceSession` for the Bearer/Postgres
 * path). The token value itself would work for either mechanism -- nothing
 * about the token is Bearer-specific or cookie-specific.
 *
 * `/milestone9` (M18-era) assumed a Bearer token would be available via
 * `localStorage.getItem('token')`, but no login flow anywhere in this
 * application has ever written to that key (confirmed by a full-tree grep
 * during the M29 GO-2 audit). That is the entire, exact reason
 * `/milestone9` has never worked for a real user.
 *
 * WHAT IS DELIBERATELY NOT DECIDED HERE
 * --------------------------------------
 * Per explicit instruction (M31 GO-2): do not reintroduce `localStorage` as
 * an implicit fix. The real resolution is one of at least two shapes, and
 * neither is implemented in this file:
 *
 *   (a) The frontend captures the `token` field already present in the
 *       login response body and holds it somewhere for the lifetime of the
 *       session (exact storage location is itself an open question --
 *       NOT necessarily `localStorage` again), then sends it as
 *       `Authorization: Bearer <token>` specifically for pipeline calls.
 *       Zero backend change.
 *
 *   (b) The image pipeline routes are migrated to also accept the cookie
 *       session, consolidating to one mechanism. This touches
 *       authentication and would need its own explicit approval before
 *       any implementation, per every prior mandate in this project.
 *
 * Neither option is chosen here. GO-4 must not silently pick one -- it
 * must stop and request an explicit decision before it can call any
 * pipeline route.
 */
export class ImagePipelineAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "The image-upload/image-analysis pipeline's authentication strategy is not yet decided (see image-pipeline-auth.ts). " +
        "This must be resolved via an explicit architectural decision before any code calls POST /api/v1/uploads or any " +
        "/api/v1/image-analyses/[assetId]/* route from the new UI."
    );
    this.name = "ImagePipelineAuthNotConfiguredError";
  }
}

/**
 * Intentionally throws. Exists as the single, unmistakable call site GO-4
 * must replace once the authentication decision above is made -- calling
 * this function anywhere is a deliberate signal that the decision has not
 * been made yet, not a bug to silently work around.
 */
export function getImagePipelineAuthToken(): never {
  throw new ImagePipelineAuthNotConfiguredError();
}
