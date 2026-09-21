# T1.6.2.c — Professional Review UI (local implementation)

## Baseline and scope

Fresh fetch verified HEAD = origin/master =
`0e0f0607fc808dd94a706b80f2c10c3a7a6c49f9`. Tracked files and staging were
clean. Seven known scratch files were untracked; their SHA-256 values below
were recorded before implementation. The continuation explicitly accepted this
baseline and instructed that it not be repeated.

This slice adds a view and professional input surface in `LearningDraftReview`,
inside Teach the AI, immediately before the separate T1.4 `ProceduralReviewSection`.
The integration is two lines: import and mount. No new page, draft lifecycle,
approval/completion button, procedural storage, or procedural revision semantics.
APPROVED mounts an interactive review; SUPERSEDED mounts historical read-only
review. Other statuses mount nothing and make no field-review GET requests.

## Authority and interaction

- Aggregate GET `/api/v1/learning-drafts/[draftId]/professional-field-decisions`
  with `cache: "no-store"` supplies all display authority. A client-only mirrored
  DTO and runtime structural guard handle the response. A compile witness checks
  assignability of the actual server adapter return type to that mirror, including
  optional wire observation values omitted by JSON serialization.
- POST `/api/v1/learning-drafts/[draftId]/professional-field-decisions/[field]`
  with JSON is the only write path. The authenticated server owns identity and
  authority. No candidate construction, action/value derivation, stale detection,
  digest calculation, database access, or server authority runtime imports.
- Vertically stacked cards cover elevation, sectioning, and guideType, with human
  field labels, authority, original AI text, canonical interpretation only when
  provided as CANONICAL, latest professional decision, controls, optional note,
  collapsed AI details, then collapsed history. Informational non-reviewable rows
  are compact. All-non-reviewable data gives one summary; existing historical
  decisions remain accessible if present.
- Radios in a fieldset/legend display exactly `actions.allowedDecisions`:
  Confirm, Correct, Cannot determine, Reject observation. Choosing does not write.
  A separate Save decision button submits an explicit choice.
- Correct reveals a full-width select containing only that field's server
  `specification.allowedValues`, in server order. It starts with an empty
  placeholder; no AI/prior correction is selected. Membership is checked before
  POST for UX; the server remains final authority. Canonical tokens, never labels,
  enter POST. No free-text professional value or field reassignment exists.
- “45° Interior” + UNRESOLVED_TEXT remains AI text. It has no canonical
  interpretation, Confirm is absent when absent from server actions, and no 45°
  value is preselected. Correction copy explicitly requires professional judgment
  and disclaims an automatic AI suggestion. A dedicated regression covers this.
- NONE means no professional decision. CURRENT displays the latest decision,
  value, note, and localized date. STALE displays a textual warning and identifies
  the latest decision as no longer current; older history is never substituted.
  Fresh stale review starts with empty decision, correction, and note.
- `actions.canSubmit: false` retains candidate/latest/history read-only and shows
  friendly lifecycle copy. SUPERSEDED is additionally read-only in the UI and
  controller. The server still checks every request.
- POST copies `expectedRevision = latestRevision`, `observationDigest`,
  `specificationVersion`, and `specificationDigest` exactly from the current GET.
  Pins remain only in memory, never editable, displayed, or placed in a URL.
- 200/201 refetch the aggregate. 409 displays a change notice and friendly reason,
  clears that form, and refetches without automatic POST retry. No optimistic
  professional-authority update. If the post-write/conflict refetch fails, that
  field stays locked until successful refresh. Other POST errors preserve input.
- Synchronous per-field pending locks prevent double submission without blocking
  unrelated cards. Injectable-fetch controller tests exercise the actual runtime.
  AbortController plus generation ordering prevent older/unmounted GETs from
  publishing; disposal also aborts/ignores POST responses.
- Form identity is field + observation pin + specification digest pin + latest
  revision. Same identity preserves unsaved input across another card's refetch;
  changed identity resets it and may show a reset notice. A conflict always asks
  for deliberate reselection even if the refreshed identity is unchanged.
- Notes are optional, maxLength 1000, with a live count; empty notes are omitted.
  Whitespace-only/overlength notes cannot submit. No note trimming, rewriting,
  sanitization, or truncation occurs. Persisted text preserves whitespace and uses
  React text and `dir="auto"`.
- Native details are initially collapsed. History is newest first, read-only,
  with revision, decision, value, note, date, and truncation message. AI details
  show source, extraction confidence (explicitly labelled), raw observation and
  extraction note when present. Confidence never controls actions or authority.
- Presentation-only progress counts reviewed, needs review, and not reviewable
  from GET state. Loading/saving/notices use role=status; Alert is reserved for
  warnings/errors. GET failures provide a small reload button. Error code/status
  mapping covers conflicts, observation/specification/lifecycle changes, source
  unavailability, 400, 401/403, 404, 413/415, 429, and temporary failures. Raw API
  messages, stack traces, and machine codes are never shown.

## Language, mobile, accessibility

Local typed ro/en dictionaries use `useUiLanguage().language`; every other UI
language falls back to English. Global translations are unchanged. English value
labels reuse CUT_ELEVATION_OPTIONS, CUT_SECTIONING_OPTIONS, CUT_GUIDELINE_OPTIONS.
Romanian keys match all governed English canonical keys in parity tests. Future
tokens remain visible with a safe humanized fallback and submit unchanged.
The older Teach the AI UI remains Romanian; that mixed-language boundary predates
this slice and global migration is deferred.

Single-column-first layout uses text-sm, min-w-0, wrapping protection, full-width
select/textarea, stacked history/radios, and min-h-11 touch targets. Real buttons,
fieldset/legend, associated labels and error descriptions, visible focus, and
textual stale warnings are local to this feature. Shared controls were not changed.
Native selects contain unusually long option text within their width (the closed
native select clips it); no document/card horizontal overflow occurs.

## Validation evidence

- Focused deterministic c suite: **68 passed**. Covers rendering, guard/contract,
  server-only actions/values/pins, 45° safety, authority/lifecycle/history, escaping,
  all required error classes, pending independence, duplicate prevention, failure
  preservation, GET ordering/unmount, per-card identity reset, labels/languages,
  input semantics, and structural security/integration.
- Regression run A: **1,071 passed in 34 files**, including the then-56-test c
  suite, b.2 API/HTTP/client boundary, b.1 persistence/boundary, b.0/b.0.1,
  structured claims, T1.5, T1.6.1, and all consultation unit tests.
- Regression run B: **174 passed in 12 files**: Brain orchestrator, reasoning
  service/contracts/validator, skill selector, execution plan/scene/visual
  compilers, TD integration boundary, and procedural service/validators/contracts.
  This is **1,189 distinct existing regression tests**, plus the final 68 c tests.
- Database regressions used only the validated localhost
  `ai_hair_architect_test` target from the existing `.env.test.local`; providers
  were deterministic mocks. No L5 scratch-writing suites, external AI calls,
  production mutations, or generation were run. Expected Prisma constraint-error
  logs came from existing negative/race tests.
- Typecheck and touched-file lint pass. Full lint passes with **120 existing
  warnings, zero errors**, matching the preceding b.2 milestone warning count.
  Production build passes with **11 existing broad storage-tracing warnings**.
  Initial sandbox build failed to fetch Google Fonts; an approved network-enabled
  retry succeeded. No font/config workaround or dependency change was introduced.
- `git diff --check` passes. Git reports the repository's LF-to-CRLF normalization
  advisory; no whitespace errors.

### Real local browser validation

`node tests/ui/professional-field-review-browser.cjs` runs installed Chromium via
the existing Playwright/esbuild tooling, serves only on loopback, renders the
actual LearningDraftReview and UiLanguageProvider with production-generated CSS,
and intercepts API responses in memory. No new dependency, production route,
database seed, or backend change is used for this fixture.

Six cases pass: **320, 375, 1280 px × ro/en**. Checks cover no page/card horizontal
overflow, readable card hierarchy, text warning, stacked radio controls, empty
correction select, long future option, full-width controls, live note editing,
Tab focus from select to textarea to Save, reachable Save, collapsed/expanded
history and AI details, long unbroken AI/professional text, exact selected token,
failed POST input preservation, friendly errors and no browser exceptions.
Screenshots were captured for all six cases and visually inspected.

Limitation: this is real browser/component validation with intercepted local API
fixtures, not a logged-in browser session reaching real persistence. Real API and
persistence integration are covered separately by the passing local TEST suites.
Browser successful-save/conflict states are controller-tested rather than claimed
as browser end-to-end evidence. The fixture's POST deliberately returns 400.

## Adversarial review

**BLOCKING findings fixed before commit:** blank/raw-only observations needed
primary-card fallback and allowance for JSON-omitted undefined values; regression
tests now cover both. Form identity explicitly uses the candidate specification
pin. Final inspection found no remaining in-scope blocker.

Inspected unsafe HTML/XSS, raw backend error rendering, editable pins, URL/storage
authority, forged identity, cross-field corrections, implicit 45° suggestion,
stale form reuse, duplicate POST, automatic conflict retry, optimistic authority,
history mutation controls, client server-runtime imports, downstream activation,
mobile overflow, and label/error/focus accessibility. Controls render React text,
POST allowlists only decision/value/note/pins, and b.2's transitive client import
boundary remains green. No HTML parsing, local/session storage, or authority query
parameters were introduced.

**NONBLOCKING:** existing lint/build warnings, existing older Romanian-only UI,
native select clipping of extreme future labels, and the browser fixture coverage
limit described above. No unrelated hardening was attempted. Backend ownership,
freshness, lifecycle, validation and append-only enforcement remain b.2/b.1 duties.

## Changed files and inert boundaries

Four new implementation files under `web/src/components/consultation/`:
`teach-ai-professional-field-review-types.ts`, `-logic.ts`, `-labels.ts`, and
`-section.tsx`; one focused `teach-ai-professional-field-review.test.ts`; two-line
integration in `teach-ai-learning-draft-review.tsx`; this milestone; and a
reproducible `web/tests/ui/professional-field-review-browser.cjs` browser check.
The browser script is the sole additional file beyond the suggested shape.

Zero changes to schema, migrations, DB models, dependency manifests/locks, API or
persistence semantics, global translations, Brain/provider behavior, or existing
procedural authority. No runtime call/import reaches binding, applicability,
eligibility resolution, Brain, reasoning package/context, prompts/providers,
selectors, SkillInstance execution, global knowledge registry, ExecutionPlan,
TD compiler, Photo Preview, Result Video, Veo/Gemini/OpenAI/Claude paths.

Deferred: T1.6.2.d skill binding/applicability, T1.6.3, eligibility or Brain
activation, generation influence, paginated history, and global Teach the AI i18n.
None is represented as implemented or as a placeholder control.

## Scratch integrity (SHA-256, before and after)

All seven remain untracked and excluded from staging/commit:

| File under web/ | SHA-256 |
| --- | --- |
| scratch-l5r1-real-video-extraction-result.json | B8698B59D54FCE1E397523D9A2016BFC90EE537253B11D66CFE6B9A7BC5EFBAD |
| scratch-l5r2-real-long-video-extraction-result.json | 6B9D0718A14FDCD5431BBC38CA1E8186B7576A5467E8737114CC6899FED4EC47 |
| scratch-l5r3-1-real-claim-binding-result.json | 568952B621EE7FF7B3E95C5BC1267EF98B27DE13791146C492EE586F3500C947 |
| scratch-l5r3-2-real-decision-classification-result.json | 12A75FCA675CEC187EF491CF7C8BBD79EF8C591C24C825C37D491138187D1B7F |
| scratch-l5r3-3-real-guide-replay-result.json | CA4FB5565B325314189F02A0B10B799074305CCE0C63087203DB86FE56F30EB7 |
| scratch-l5r3-4-real-assimilation-plan-result.json | 8F274FB68F640A3DCF2B221EE141BED2A44B1468BCAA93A7A47CB998B1AB217B |
| scratch-l5r3-real-assimilation-proposal-result.json | 2FFB2618A0CF3B0122BB540D68587A5356FE57549EB6A711AE9715A422F14AA5 |

Delivery is one local atomic commit with the baseline above as parent. No push,
deployment, or next-stage work is part of this milestone.
