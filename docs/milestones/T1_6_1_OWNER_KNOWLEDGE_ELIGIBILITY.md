# T1.6.1 — Owner-Scoped Knowledge Eligibility Resolution

Baseline: `19a85dca686bfbeaa90e863aad241330287715fd`.

This slice adds representation only. No current procedural frequency claim,
including a professional free-text correction, proves a decision-relevant
skill/context binding. The resolver therefore has only an `INELIGIBLE` result
in this version. Extra fields claiming bindings are ignored, never accepted.
Creating an eligible class requires a separately reviewed future contract.

## Flow and authority

`prepareReasoningRequestPackage` first validates the owned client and existing
confirmed states and computes the unchanged candidate selection. It then calls
the owner listing once. The listing selects approved, non-superseded drafts for
that owner and calls the existing T1.5 read service for each draft. T1.5 remains
the source-chain authority (evidence lifecycle, owner, video/client ownership,
source accessibility and current review). Rejected, UNKNOWN and unreviewed
claims cannot become knowledge entries and do not enter eligibility.

The resolver is pure and receives only the reviewed entry and the authorized
owner plus a negative global-conflict veto. That veto comes from the existing
selector's `preserveConstraintConflict` diagnostics. It adds a refusal reason;
absence of a veto does not prove compatibility. No claim-to-constraint mapping
or global-skill-version binding is invented here.

Reason codes are a frozen closed vocabulary in `owner-knowledge-eligibility.ts`.
Current valid claims always receive `CLAIM_CLASS_NOT_DECISION_RELEVANT`,
`SKILL_BINDING_MISSING` and `CONTEXT_BINDING_MISSING`. Invalid owner, review,
class, version, or correction adds/reports explicit refusal reasons.

## Sealed package, unchanged provider context

The optional `knowledgeEligibility` section is a **sibling** of the existing
package `context`. It is not a field on `ProfessionalReasoningContext`.
This distinction prevents a private section from reaching `provider.reason(context)`.
No prompt, provider adapter, reasoning service, validator, selector, compiler,
global registry or live consultation consumer is changed.

Nonempty sections contain canonical, sorted, deduplicated evaluations and are
deeply frozen, including provenance references and reason arrays. Only audit
references and a content digest are carried: no original AI value or corrected
professional text is copied into the section. Correction text over 2,000 UTF-16
code units or containing disallowed controls/lone surrogates is ineligible;
the stored review and review API are not changed or truncated.

The optional `requestFingerprint` hashes the existing provider context
fingerprint plus the canonical owner-scoped section. The helper
`reasoningRequestPackageFingerprint` returns this fingerprint for nonempty
packages and the unchanged `context.contextFingerprint` for legacy/empty ones.
The helper is not used for proposal lookup or persistence. For empty listings,
neither new property is inserted: package JSON, context JSON and the existing
fingerprint remain bit-for-bit unchanged. Even with a nonempty section, the
provider context and its fingerprint remain unchanged.

Provenance includes knowledge/draft/evidence/video/claim IDs, the decision-slot
reference and revision, reviewer/time, extractor/bridge/projection versions,
and `t1.6.1-eligibility-v1`. A content digest identifies evaluated content without
carrying the free text forward.

## Freshness and limits

There is no knowledge/eligibility cache or new persistence. Each preparation
reads current T1.5 projections. A second draft-version listing detects additions,
removals, supersession or revision changes during collection and refuses the
package rather than silently mixing changed reviews. Each source has T1.5's
read-time checks; the resulting package is an audit snapshot, not ongoing
authority after subsequent source/review changes.

The listing is bounded to 100 approved drafts and 1,000 projected entries;
overflow fails explicitly rather than returning a partial success. Invalid or
inaccessible source chains (T1.5 404/409) contribute no knowledge. Operational
read failures (503) propagate and are not disguised as empty knowledge.
These limits and failures affect package availability, not professional choices.

## Deferred owner/fingerprint issue

`findReasoningProposalByFingerprint` still looks up by
`contextFingerprint/provider/model` without owner. It is called by the unchanged
`runProfessionalReasoning` path, which builds its own legacy context. The new
preparation/listing/section path does not call that function, reuse proposals,
invoke a provider or persist a proposal. Its nonempty package fingerprint also
includes the owner. Consequently this slice does not expose private eligibility
through that latent lookup. Repair and authorization for an activation path
remain explicitly deferred to T1.6.3; the latent issue itself is not resolved.

## Verification boundaries

Tests cover real local Postgres owner isolation, revocation and changed reviews;
pure fail-closed reasons and correction limits; canonical frozen sections;
legacy empty-package/context fingerprint compatibility; identical rendered
provider requests with a fake transport; and unchanged decision components.
Boundary tests permit exactly one orchestrator integration and verify that the
resolver's transitive runtime dependencies contain no I/O/provider/registry.
Baseline hashes lock the existing provider, context, reasoning, registry,
selector, validator and compiler files for this slice.

No migration, dependency, UI, public route, persistent binding, T1.6.2 or T1.6.3
activation is part of this change.
