# AI Hair Architect - Milestone 2 Technical Plan

Status: Draft for approval
Date: 2026-07-16
Depends on:
- PRODUCT_ARCHITECTURE.md
- TECHNICAL_IMPLEMENTATION_BLUEPRINT.md
- Milestone 1 completed and validated

## 1. Milestone 2 Goal

Implement Analysis and Consultation Core as a strict extension of Milestone 1:
- photo-aware analysis request flow (MVP-safe)
- confidence and uncertainty handling
- clarifying questions loop
- consultation composer and persistence
- no scope expansion into Milestone 3+

Out of scope for this milestone:
- full media processing pipeline
- video generation
- calendar reminders
- marketplace ranking engine
- billing hardening
- advanced multi-agent orchestration

## 2. Scope Boundaries

In scope:
- frontend analysis workspace and consultation save flow
- backend analysis lifecycle endpoints
- backend clarify endpoint and result retrieval
- consultation history listing per client
- typed contracts update for analysis lifecycle
- database-level modeling in local persistence layer compatible with future DB migration
- test coverage for low-confidence branching and clarifying questions

Out of scope:
- production AI provider integration (use adapter boundary + mock strategy)
- object storage provider integration (temporary local payload metadata)
- full RBAC matrix beyond Milestone 1 role baseline

## 3. Frontend Architecture Plan

## 3.1 New frontend feature modules

- Feature module: analysis-workspace
  - start analysis request
  - render confidence score
  - render uncertainty reasons
  - render follow-up questions
  - submit clarifications
  - display final recommendations and safety notes

- Feature module: consultation-composer
  - pre-fill from analysis output
  - editable summary and next steps
  - persist consultation
  - show save confirmation

## 3.2 Frontend page structure changes

- Keep current main page intact
- Add a dedicated Milestone 2 section under existing navigation
- Reuse milestone style language with isolated component boundaries

## 3.3 Frontend state model

- analysisSession state:
  - analysisId
  - phase: pending_questions | ready
  - confidenceScore
  - uncertaintyReasons
  - followUpQuestions
  - clarificationAnswers
  - recommendations
  - safetyNotes

- consultationDraft state:
  - clientId
  - analysisId
  - summary
  - nextSteps

## 3.4 Frontend API client boundaries

- service: analysisApi
  - start(payload)
  - clarify(analysisId, answers)
  - getResult(analysisId)

- service: consultationApi
  - create(payload)
  - listByClient(clientId)

All service functions consume shared contracts only.

## 4. Backend Architecture Plan

## 4.1 New backend route handlers

Target path family: web/src/app/api/v1

- POST /analysis/start
  - upgrade existing endpoint to persistent lifecycle record

- POST /analysis/:id/clarify
  - accept clarification answers
  - recompute confidence and follow-up state

- GET /analysis/:id/result
  - return latest analysis state

- GET /clients/:id/consultations
  - return consultation history ordered by createdAt desc

- POST /consultations
  - validate analysis reference and readiness
  - persist consultation

## 4.2 Analysis orchestration boundary

Add adapter boundary (no real provider yet):
- analyzeInitial(input)
- analyzeWithClarifications(previousState, answers)

Adapter returns deterministic structured output with:
- confidenceScore
- uncertaintyReasons
- followUpQuestions
- recommendations
- safetyNotes

## 4.3 Domain validation rules

- analysis start requires existing client and minimum inputs
- if confidence below threshold and follow-up questions exist, phase is pending_questions
- consultation creation blocked until phase is ready
- consultation must reference valid analysisId and clientId pair

## 5. Data Model Plan (Milestone 2)

Milestone 1 currently uses in-memory store. Milestone 2 extends it with explicit entities compatible with future SQL migration.

## 5.1 New logical entities

- analysisRecords
  - id
  - clientId
  - createdByUserId
  - goal
  - hairType
  - density
  - porosity
  - phase
  - confidenceScore
  - uncertaintyReasons
  - followUpQuestions
  - recommendations
  - safetyNotes
  - createdAt
  - updatedAt

- analysisClarifications
  - id
  - analysisId
  - answers
  - createdAt

- consultationRecords
  - existing from M1, extended with validation linkage

## 5.2 Planned SQL migration mapping (design only)

Future tables:
- analysis_results
- analysis_clarifications
- consultations

Future indexes:
- analysis_results(client_id, created_at)
- analysis_clarifications(analysis_id, created_at)
- consultations(client_id, created_at)

## 6. User Flows (Milestone 2)

## 6.1 Flow A - Start analysis

1. User selects client from M1 client list.
2. User selects analysis inputs.
3. Frontend calls POST /analysis/start.
4. Backend returns either:
   - ready result if confidence high
   - pending_questions if confidence low

## 6.2 Flow B - Clarification loop

1. If pending_questions, user answers follow-up questions.
2. Frontend calls POST /analysis/:id/clarify.
3. Backend updates analysis and returns updated phase.
4. If still uncertain, one more clarification round allowed (max rounds configurable).

## 6.3 Flow C - Save consultation

1. When analysis phase is ready, user reviews recommendations.
2. User edits summary and next steps.
3. Frontend calls POST /consultations.
4. User sees confirmation.
5. History is loaded from GET /clients/:id/consultations.

## 7. New and Modified Files Plan

This section is implementation plan only, not executed yet.

## 7.1 New files planned

- web/src/components/milestone2-analysis-panel.tsx
- web/src/lib/analysis-engine.ts
- web/src/lib/analysis-thresholds.ts
- web/src/lib/milestone2-types.ts
- web/src/lib/milestone2-store.ts or extension file for current store
- web/src/app/api/v1/analysis/[id]/clarify/route.ts
- web/src/app/api/v1/analysis/[id]/result/route.ts
- web/src/app/api/v1/clients/[id]/consultations/route.ts
- web/src/lib/analysis-engine.test.ts
- web/src/app/api/v1/analysis/analysis-routes.test.ts (if route test harness is added)

## 7.2 Modified files planned

- web/src/lib/contracts.ts
- web/src/lib/milestone1-store.ts
- web/src/app/api/v1/analysis/start/route.ts
- web/src/app/api/v1/consultations/route.ts
- web/src/app/page.tsx
- web/src/app/globals.css
- web/package.json (only if extra test tooling is needed)

## 8. Test Plan

## 8.1 Unit tests

- analysis confidence decision rules
- clarification transition rules
- consultation readiness validation
- thresholds and fallback behavior

## 8.2 Integration tests

- analysis start returns pending_questions for low-confidence scenario
- clarify endpoint transitions to ready when answers sufficient
- consultation create fails when analysis not ready
- consultation create succeeds when analysis ready
- consultation list returns records for client

## 8.3 UI flow tests

- user can complete analysis workflow end-to-end
- user can save consultation after ready state
- user sees uncertainty reasons and safety notes

## 8.4 Regression tests

- Milestone 1 auth and client CRUD still pass
- localization behavior from M1 unchanged

## 9. Validation and Acceptance Criteria

Milestone 2 is accepted only if all criteria below are met:

Functional:
- analysis lifecycle endpoints implemented and reachable
- clarifying question loop works with phase transitions
- consultation save is gated by readiness
- consultation history per client available

Quality:
- lint passes
- typecheck passes
- tests pass
- build passes

Runtime:
- app starts without runtime errors
- analysis and consultation flow verified manually and via test script

Traceability:
- updated contracts documented
- endpoint behaviors documented
- result payloads deterministic and typed

## 10. Risks and Mitigations

- Risk: scope drift into advanced AI orchestration
  - Mitigation: strict adapter abstraction and deterministic mock outputs only

- Risk: coupling with Milestone 1 in-memory store
  - Mitigation: isolate analysis storage logic behind dedicated module

- Risk: unstable confidence logic creates flaky tests
  - Mitigation: fixed threshold constants and deterministic scoring paths

- Risk: frontend complexity growth on single page
  - Mitigation: dedicated component module and service boundaries

- Risk: regression in M1 auth/client flow
  - Mitigation: mandatory regression suite for M1 before milestone closure

## 11. Implementation Sequence (after approval)

1. Extend contracts and store model.
2. Implement backend analysis lifecycle routes.
3. Implement consultation gating and client consultation listing.
4. Implement frontend analysis + consultation panel.
5. Add tests (unit + integration + regression).
6. Run full validation gates and produce milestone report.
7. Stop and wait for approval before Milestone 3.

## 12. Approval Gate

No implementation starts until this plan is approved.
After approval, execution will be strict, step-by-step, and limited to Milestone 2 only.
