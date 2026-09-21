# T1.6.2.b.2 — professional field decision API

Baseline: `ccc51622650ada291fc1c3254e705420f690d5b3`.

The HTTP layer adapts existing b.1 authority. It adds only:

- GET `/api/v1/learning-drafts/[draftId]/professional-field-decisions`
- POST `/api/v1/learning-drafts/[draftId]/professional-field-decisions/[field]`

There is no UI, history endpoint, per-field GET, binding, applicability,
eligibility activation, Brain, reasoning, prompt, provider, registry,
ExecutionPlan, Technical Demonstration or video integration. No schema or
migration changes are required.

## Authority and read snapshot

Authentication through `authenticateSessionRequest()` precedes parameter/body
handling. Only the session user's id supplies owner authority. There is no new
role gate. Foreign and missing drafts have identical static 404 responses.

The additive `readProfessionalFieldDecisionReview()` function runs one
RepeatableRead transaction. It reuses b.1's owned-draft, lifecycle, current
candidate/governance and stale-decision helpers. Existing submission semantics
and existing unbounded internal history reads remain unchanged. Supported fields
come from the canonical registry in insertion order: elevation, sectioning,
guideType. The route does not derive professional authority.

Each field queries descending revisions with `take: 11`, emits at most ten rows
newest first, and uses the eleventh row only to detect historyTruncated. The
newest row is always latest; stale history cannot reactivate an older row.
No latest means NONE; otherwise authority is CURRENT or STALE. Current candidate
pins allow deliberate re-review after observation/specification staleness when
the current specification is approved. Lifecycle blocks and unapproved
specifications prevent submission.

Allowed decisions are discovered by probing the existing b.0 validator. For
CORRECTED, at least one value in the governed allowedValues must validate.
These describe candidate semantics independently of lifecycle; canSubmit and
blockedReason state whether submission is currently available. There is no
duplicated matrix or canonical vocabulary.

## Privacy and errors

Both handlers set `Cache-Control: private, no-store` on every response, including
authentication, validation, rate-limit and exception responses. Explicit decision
DTOs contain field, revision, decision, professionalValue, note and createdAt.
They exclude row ids, owner/reviewer ids and historical row digests. GET exposes
the authorized current candidate's original observation and its existing frame
references, sourceEvidenceId, extractorVersion and current submission pins.
It does not load storage URLs or return storage metadata, credentials or siblings.

POST accepts only expectedRevision, observationDigest, specificationVersion,
specificationDigest, decision, correctedValue and note. URL field/draft identity
cannot be overridden by body, query or headers. The adapter checks shape and
primitive types; b.1/b.0 retains decision, correction and note policy authority.

Errors use static bodies. Revision/stale conflicts include refreshRequired=true
and a static refresh instruction. Recognized Prisma known-request, unknown-request,
initialization, validation and panic error classes map to 503. Other unexpected
failures map to 500. b.1 still maps its revision races to domain 409 errors first.
New HTTP logging
contains only a fixed route tag, classified error class/status and a validated
Prisma code when available; it never logs the exception object/message, SQL,
stack, request body, note or AI observation. Existing global Prisma infrastructure
is unchanged.

## Local request safeguards and deployment trust

POST uses the existing in-memory checkRateLimit with the key
`professional-field-decision:<session user.id>`, 30 requests per 60,000 ms.
Authenticated attempts consume the limit before origin/media/body handling, then
URL field validation and the owner-scoped service. GET is
unrate-limited. The limiter is per process and resets on restart; no distributed
guarantee is implied.

JSON media type comparison is case-insensitive and permits parameters. The local
reader rejects declared lengths over 8192 bytes and independently counts actual
stream bytes, cancels on overflow, and rejects empty/malformed JSON or invalid
UTF-8. A misleading or absent Content-Length cannot bypass the byte limit.

When Sec-Fetch-Site is present, only the exact browser value `same-origin` is
accepted. Otherwise Origin, when present, must be an HTTP(S) origin without
credentials/path/query/fragment. Its normalized host is compared with
x-forwarded-host, falling back to Host. Hostnames are case-insensitive; the Origin
scheme normalizes its default port on both hosts (80 for HTTP, 443 for HTTPS).
Explicit nondefault ports must match. The backend URL's scheme is not compared.
Malformed hosts and forwarded lists fail closed.
Requests lacking both browser-origin headers remain supported for authenticated
non-browser tooling.

The forwarded-host value is trusted ONLY under the existing Railway ingress
assumption: ingress controls/overwrites that header and the backend is not
directly exposed to untrusted clients. This is not a portable trust rule for
arbitrary reverse proxies. Browser Sec-Fetch-Site is browser-controlled; raw
clients still require valid authentication. No global CSRF/config change is made.

## Tests and implementation scope

Focused tests cover authentication order, safe HTTP error mapping/cache headers,
strict input, byte limits/cancellation, actual rate limiting, proxy origin cases,
GET privacy, all candidate states, parity with b.0, owner isolation, immutable
history, R1 behavior, lifecycle/governance staleness and the 45° trap. Boundary
tests allow only the two handlers/HTTP adapter to consume b.1, prohibit direct or
nested decision-table references outside the service, and traverse client runtime
imports to exclude candidate/governance/decision authority (erased type imports
are excluded). All original b.1 behavior tests remain in place.

HTTP R1 semantics remain exactly b.1's: current identical submissions return
200 UNCHANGED without a new row; changed valid submissions return 201 CREATED at
revision + 1; stale revisions return 409 REVISION_CONFLICT even for identical
content. There is no retry. Required pins that are absent, empty or whitespace
are rejected as 400 at the adapter boundary before b.1.

The aggregate snapshot integration test commits draft/evidence/revision changes
on a separate connection after its first read. The in-progress aggregate still
returns the original candidate, live lifecycle, current pins and original latest
history; the next aggregate sees the changed lifecycle and new revision. The test
checks exactly one RepeatableRead transaction and three owner-scoped descending
history queries, each with take=11, and rejects writes through its observed
transaction delegates. Concurrent duplicate and competing HTTP POST tests each
require exactly one 201, one 409 and one persisted revision.

Only the established localhost test database is used; no provider calls or
scratch-writing L5 suites run. Schema, migrations, packages and CI are unchanged.

Final validation: 937 tests passed across 44 files: 122 new b.2 tests, all 73 b.1
tests, 199 a/b.0/b.0.1 tests, 511 safe T1.5/T1.6.1/Brain/reasoning/selector/compiler
regressions and 32 auth/learning-route regressions. Prisma validation, typecheck,
and changed-file lint passed. Full lint passed with zero errors and 120 existing
warnings. No existing b.1 submission, transaction, lifecycle, owned-draft or
identity function body changed, confirmed by source comparison.
The production build passed with the same 11 pre-existing filesystem-tracing
warnings. Diff checks passed; all seven untracked scratch hashes are unchanged.

## Adversarial review and deferred limits

No remaining BLOCKER was identified after reviewing IDOR/owner and field forgery,
forged/missing pins, unknown keys, cross-origin/malformed Origin requests, payload
overflow, malformed JSON, note injection, error/stack leakage, alternate nested
writes, client runtime imports, cross-field corrections, the 45° trap, stale
replays, revision races, bounded history and downstream activation. Missing/blank
pins are contained at the HTTP boundary, all recognized Prisma error classes are
sanitized to 503, and explicit nondefault ports are not collapsed across origins.

NONBLOCKING architectural limits remain explicit: trusted Railway ingress owns
forwarded-host, the limiter is per-process memory, the snapshot is not a guarantee
against changes committed after that snapshot, and application append-only access
does not restrict privileged direct SQL. Existing global Prisma logging is
unchanged; the new adapter logs sanitized metadata only. Existing lint/build
warnings are outside this slice. No unrelated hardening was performed.

Deferred: UI and human labels/i18n (c), paginated history, binding/applicability,
eligibility/Brain activation, prompts/providers, ExecutionPlan/TD/video, retroactive
CSRF changes, distributed limiting, revision caps, DB CHECK constraints, storage
HEAD proof and new global observability. None is implemented by b.2.
