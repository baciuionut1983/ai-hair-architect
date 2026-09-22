# T1.6.2.c.1b — Version-Aware Learning Draft Analysis

Local implementation only. Freshly fetched HEAD and origin/master baseline:
`040b1226d265bb37e13e399b3d0709209b2f502a`.

## Root cause and intentional replacement

OLD CONTRACT: Analyze first listed every draft for an evidence item, selected the
first non-superseded entry (or any history), and returned without POST. A historical
approved v1 draft therefore prevented current-version extraction.

NEW CONTRACT: an eligible Analyze invocation directly POSTs `{ mode: "ANALYZE" }`
to `/api/v1/learning-evidence/{evidenceId}/drafts`. The existing server selects the
extractor and returns or creates its exact-version draft. The client validates the
POST result, then GETs that exact draft ID for existing procedural hydration.
There is no draft-list GET, client version/model constant, version selector,
provider metadata, version query parameter or new request field.

Repeat invocations also use ANALYZE, never REANALYZE. This is necessary for the
required zero-provider-cost reuse contract. The existing button label helper is
unchanged: its legacy expanded-state label can still say “Reanalizează”, but this
handler now requests idempotent Analyze. It does not force a fresh extraction.
The server's separately supported REANALYZE semantics are unchanged.

## Exact intentional test replacements

The following six original test declarations asserted the obsolete shortcut:

1. `does no mount requests; GET-first recovers existing state without Analyze`
2. `recovers existing %s without a provider request` (five status cases)
3. `uses server ordering and prefers current over superseded history`
4. `falls back to Analyze only for a successful empty GET and then hydrates`
5. `GET failure %s never falls back to Analyze` (three HTTP status cases)
6. `malformed existing hydration fails closed without Analyze`

They now verify direct POST, server-selected states, history unable to short-circuit,
new-draft hydration, POST failure and fail-closed malformed results. The previous
`reanalysis keeps current content pending and on failure` test intentionally now
asserts repeated ANALYZE, while preserving its pending/error content assertions.
Unrelated review tests retain their assertions, with request indices shifted by
the additional POST before hydration. The controller harness mocks both responses.

Added coverage includes ordinary double-click, repeated completed Analyze,
mismatched/invalid hydration, server skip, aborted request and exact payload with
no client version authority. No mount request was added. The controller has no
existing unmount cancellation/dispose contract; this change introduces no new
subscription, automatic retry or background request. Abort failure clears busy.

## Existing server contract (zero production change)

Server derives current extractor identity, currently `gemini-real-v2:${model}`.
Lookup includes owner, evidence and exact extractor version; unique constraint is
`(sourceEvidenceId, extractorVersion)`, with existing P2002 recovery.

- No current version: one normal extraction path and a new DRAFT on success.
- Historical v1 APPROVED only: does not match v2; old draft/history is untouched.
- Current v2 DRAFT or APPROVED: return it, no provider work, no new version.
- Current exact-version SUPERSEDED: return `already_processed` with that same
  SUPERSEDED record. Existing UI treats it as history; no replacement or revival.
- Future model/version changes: no client update is needed; the next eligible
  Analyze POST lets the server determine current identity.

The expanded local TEST DB integration test proves one mocked provider call for
creation, zero additional calls on DRAFT/APPROVED/SUPERSEDED reuse, separate IDs,
new review state empty at revision zero, and unchanged historical approved row.
Existing repository/service regressions cover uniqueness recovery and owner scope.
No old extraction, decisions or T1.4 authority are copied into the new draft.

## Lifecycle, concurrency and authority

New DRAFT remains DRAFT until separate explicit review actions. The professional
field-review c section remains unmounted for DRAFT. Existing APPROVED/REJECTED/
SUPERSEDED/REANALYZING guards on an already-loaded card remain unchanged. A fresh
card still sends Analyze and can receive any exact-version status from the server.
The POST response ID is authoritative; hydration cannot substitute a different ID.

The synchronous busy guard blocks ordinary double-click through POST and hydration.
DB uniqueness is final duplicate-row protection. NONBLOCKING existing limitation:
simultaneous separate windows may both start provider work before one insert wins
and the other's uniqueness recovery returns the same row. No distributed lock or
provider orchestration redesign is included.

No server production, Prisma, migration, dependency, lockfile, environment/config,
provider, extractor, c mounting, professional-decision authority or downstream
activation change. No skill binding, applicability, eligibility, Brain/reasoning,
ExecutionPlan, TD or generation activation. T1.6.1 remains INELIGIBLE-only.

## Future real-video acceptance procedure — NOT executed

After independent review and a separately authorized release:

1. Open the existing ACTIVE professional video evidence in a fresh card/page.
2. Click “Analizează material (draft)” once.
3. Client POSTs directly; server selects current v2.
4. If no exact-version draft exists, one normal real Gemini extraction occurs.
5. New v2 DRAFT is hydrated and displayed. If v2 already exists, it is reused.
6. STOP immediately. Do not approve, reject, reanalyze or save professional decisions.
7. Compare raw v2 extraction against preserved historical v1, particularly elevation,
   sectioning and guideType. c is not mounted before approval; this is expected.

No history browser, version badge or selector is introduced. Comparison with v1 is
an acceptance-review activity using preserved historical information, not a new UI.

## Validation and adversarial review

All gates passed:

- 65 safe regression suites, 1,301 tests passed, including 62 controller tests.
- Coverage: draft service/repository and routes, extractor versioning, c.1a,
  b.0/b.0.1/b.1/b.2/c, T1.5/T1.6.1, Brain/reasoning/selector/compiler boundaries.
- Local TEST DB only where needed; synthetic provider clients only.
- Typecheck and touched-file lint passed, zero warnings.
- Full lint: 0 errors, 120 PRE-EXISTING warnings, 0 NEW warnings.
- Production build passed: 11 PRE-EXISTING storage tracing warnings, 0 NEW warnings.
- git diff --check passed; scratch hashes unchanged.

Final scope: one production controller, its tests, the existing draft integration
fixture/test and this milestone. No server production file changed.

BLOCKING findings resolved: historical list shortcut, and repeat invocations using
REANALYZE instead of idempotent ANALYZE. Review verifies no client extractor authority,
ignored POST result, copied decisions, old-draft mutation, weakened validation,
owner-scope change, early c mounting, backend production change or activation.
NONBLOCKING: existing cross-window cost race and legacy expanded-state button label.

Seven scratch artifacts are preserved untracked against the SHA-256 baseline in
T1_6_2_C_PROFESSIONAL_REVIEW_UI.md. Known L5 scratch-writing and real-provider suites
are excluded. Test DB fixtures only; zero production DB access, real provider calls,
real draft creation, video reanalysis, push, deployment, d or T1.6.3 work.
