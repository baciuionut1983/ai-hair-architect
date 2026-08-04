# AI Hair Architect - Technical Implementation Blueprint

Status: Technical Architect Approved
Date: 2026-07-16
Depends on: PRODUCT_ARCHITECTURE.md

Purpose: Define a complete, modular, testable technical implementation plan for AI Hair Architect. This blueprint enforces milestone-by-milestone delivery with stop-and-approve gates.

## 1. Architecture Principles

- Modular first: each module can be built, run, and tested in isolation.
- Contract driven: frontend and backend communicate only through typed API contracts.
- Safety first: AI recommendations must expose confidence and request clarifying input when needed.
- Backward-safe rollout: avoid breaking existing behavior while migrating.
- Test before merge: every milestone must pass defined functional and quality gates.

## 2. Target System Architecture

## 2.1 Frontend Architecture

Technology:

- Next.js App Router
- TypeScript strict mode
- Domain modules by feature
- Shared UI system and localization layer

Frontend layers:

- App shell and routing layer
- Feature module layer
- Shared component layer
- API client layer
- State and cache layer
- Localization layer

State strategy:

- Server state: React Query (or equivalent)
- UI state: local component state and context per module
- Form state: schema-validated forms

Isolation rules:

- No cross-imports between feature internals
- Shared contracts only via shared package
- Feature flags around incomplete modules

## 2.2 Backend Architecture

Technology:

- Node.js + TypeScript service layer
- REST APIs first, optional internal event bus
- Queue workers for async jobs

Backend layers:

- API gateway/router
- Auth and RBAC service
- Domain services
- AI orchestration service
- Notification service
- Billing service
- Supplier and marketplace service
- File and media service

Isolation rules:

- Each domain service owns its schema and business logic
- Shared access only through explicit service interfaces
- AI orchestration cannot directly mutate core business tables

## 2.3 Data Architecture

Primary storage:

- PostgreSQL for relational domain data
- Object storage for images and generated video assets
- Redis for cache, short-lived sessions, and job coordination

Data boundaries:

- Client data domain
- Consultation and analysis domain
- Learning and media domain
- Commerce domain
- Audit and observability domain

## 2.4 AI Architecture

Model strategy:

- Router layer picks model by task type
- Vision-capable model for photo analysis
- Reasoning model for consultation synthesis
- Optional lightweight model for quick classification

AI safety and confidence:

- Every recommendation returns confidence_score and uncertainty_reasons
- If confidence below threshold, system returns follow_up_questions
- No high-risk service output without required inputs

## 3. Monorepo Structure

Recommended folder layout:

```text
ai-hair-architect/
  PRODUCT_ARCHITECTURE.md
  TECHNICAL_IMPLEMENTATION_BLUEPRINT.md
  apps/
    web/                        # Next.js frontend
    api/                        # Backend API service
    worker/                     # Async jobs (notifications, media tasks)
  packages/
    contracts/                  # Shared API schemas and DTOs
    ui/                         # Shared design system components
    i18n/                       # Localization dictionaries and helpers
    ai-sdk/                     # Model adapter and orchestration helpers
    config/                     # Shared lint/ts/build configs
  infrastructure/
    docker/
    migrations/
    scripts/
    monitoring/
  docs/
    architecture/
    runbooks/
```

Migration note:

- Existing project files remain intact.
- New structure can be introduced incrementally without deleting legacy code.

## 4. Module Decomposition (Independent Units)

Each module below has independent ownership, APIs, tests, and release criteria.

## 4.1 Auth and Identity Module

Scope:

- Sign up, sign in, sign out
- Session lifecycle
- Role assignment
- Plan-aware permissions

Inputs/outputs:

- Input: credentials, role selection
- Output: access token/session, user profile, permissions

Dependencies:

- Users table
- Sessions store
- RBAC policies

Independent test gate:

- Can be tested with mock downstream services

## 4.2 Localization Module

Scope:

- Auto language detection
- Manual language override
- Persistent language preference
- Country-local terminology maps

Dependencies:

- User preferences
- i18n dictionaries

Independent test gate:

- Unit tests for language resolution
- Snapshot tests for localized UI strings

## 4.3 Client Profile and History Module

Scope:

- Client records
- Photo timeline
- Formula timeline
- Treatment timeline
- Appointment timeline

Dependencies:

- Auth module
- File storage

Independent test gate:

- CRUD + audit trail + timeline ordering tests

## 4.4 Hair Analysis Module

Scope:

- Photo ingestion
- Analysis request orchestration
- Confidence and uncertainty handling
- Clarifying question generation

Dependencies:

- AI orchestration
- Client history module

Independent test gate:

- Deterministic contract tests with mocked model responses

## 4.5 Consultation and Recommendation Module

Scope:

- Merge history + analysis + goals
- Produce structured recommendations
- Produce risk and safety notes

Dependencies:

- Hair analysis
- Client history
- Agent outputs

Independent test gate:

- Golden output tests for key consultation scenarios

## 4.6 Academy and Professional Library Module

Scope:

- Taxonomy-driven content navigation
- Lessons by category
- Technique details and warnings

Dependencies:

- Localization
- Content tables

Independent test gate:

- Content integrity tests and route-level rendering tests

## 4.7 Video Lesson and Demo Module

Scope:

- Lesson recommendations
- Demo script generation
- Media processing workflow

Dependencies:

- Content module
- Worker queue
- Object storage

Independent test gate:

- Async job lifecycle tests and media metadata validation

## 4.8 Marketplace and Supplier Module

Scope:

- Product catalog
- Supplier discovery by country/city
- Relevance ranking
- Shortlist and recommendation linkage

Dependencies:

- Localization
- Product and supplier datasets

Independent test gate:

- Ranking logic tests and localization-aware filtering tests

## 4.9 Billing and Subscription Module

Scope:

- Plans
- Checkout session integration
- Subscription state sync
- Access gate updates

Dependencies:

- Auth
- Payment provider API

Independent test gate:

- Webhook signature and subscription state transition tests

## 4.10 Notification and Calendar Module

Scope:

- Appointment reminders
- Follow-up reminders
- Maintenance reminders

Dependencies:

- Client history
- Worker service

Independent test gate:

- Scheduling, retry, and idempotency tests

## 5. API Blueprint (Versioned)

Base: /api/v1

## 5.1 Auth APIs

- POST /auth/register
- POST /auth/login
- POST /auth/logout
- GET /auth/me

## 5.2 Client APIs

- GET /clients
- POST /clients
- GET /clients/:id
- PATCH /clients/:id
- POST /clients/:id/photos
- GET /clients/:id/timeline

## 5.3 Analysis APIs

- POST /analysis/start
- POST /analysis/:id/clarify
- GET /analysis/:id/result

Response contract minimum:

- analysis_id
- confidence_score
- uncertainty_reasons
- follow_up_questions
- recommendations
- safety_notes

## 5.4 Consultation APIs

- POST /consultations
- GET /consultations/:id
- GET /clients/:id/consultations

## 5.5 Formula and Treatment APIs

- POST /clients/:id/formulas
- GET /clients/:id/formulas
- POST /clients/:id/treatments
- GET /clients/:id/treatments

## 5.6 Academy APIs

- GET /academy/categories
- GET /academy/lessons
- GET /academy/lessons/:id

## 5.7 Video APIs

- POST /video-lessons/generate
- GET /video-lessons/:id

## 5.8 Marketplace APIs

- GET /products
- GET /suppliers
- GET /suppliers/recommended
- POST /shortlists

## 5.9 Billing APIs

- POST /billing/checkout
- POST /billing/webhook
- GET /billing/subscription

## 5.10 Notification APIs

- GET /notifications
- POST /notifications/read
- POST /appointments
- GET /appointments

## 6. Database Blueprint

Key tables:

- users
- user_roles
- sessions
- organizations
- clients
- client_photos
- consultations
- analysis_results
- analysis_questions
- analysis_clarifications
- color_formulas
- treatment_records
- appointments
- appointment_reminders
- products
- suppliers
- supplier_regions
- shortlists
- subscriptions
- payments
- notifications
- lessons
- video_lessons
- audit_events

Critical indexes:

- clients(owner_user_id, created_at)
- client_photos(client_id, created_at)
- consultations(client_id, created_at)
- appointments(user_id, starts_at)
- suppliers(country_code, city, category)
- notifications(user_id, read_at)

Data quality constraints:

- Soft delete for user-facing records
- Immutable audit events
- Foreign keys on all timeline entities
- Validation for enum states (plan, status, reminder type)

## 7. AI Integration Blueprint

## 7.1 AI orchestration contracts

Input envelope:

- request_id
- user_role
- locale
- country
- client_context
- analysis_context
- requested_tasks

Output envelope:

- task_results
- confidence_score
- uncertainty_reasons
- required_follow_up_questions
- safety_flags
- trace_id

## 7.2 Model adapters

- Vision adapter for image understanding
- Reasoning adapter for synthesis and consultation
- Content adapter for lesson and demo generation

## 7.3 Prompt and policy controls

- Prompt templates versioned by task
- Policy checks before and after model output
- Structured parser validation before persistence

## 8. User Flows to Implement

## 8.1 Flow A: New consultation

1. Authenticate.
2. Select or create client.
3. Upload photo.
4. Start analysis.
5. Answer clarifying questions if requested.
6. Review recommendations.
7. Save consultation and next steps.

## 8.2 Flow B: Repeat visit

1. Open client timeline.
2. Compare previous photos and formulas.
3. Run fresh analysis.
4. Adjust treatment and formula plan.
5. Schedule follow-up.

## 8.3 Flow C: Product and supplier support

1. Review recommendation-linked products.
2. Filter by country and city availability.
3. Save shortlist.
4. Attach products to consultation.

## 9. Milestones, Estimates, Dependencies

Note: PRODUCT_ARCHITECTURE.md §9.7-9.8 records a long-term, non-MVP platform/vertical-expansion ambition (marketplace, brand pages, courses, nails/make-up/cosmetics). It is out of scope for this blueprint's milestone list, which remains hairstyling-only, until a dedicated blueprint for that ambition is written and approved.

Estimation scale:

- S: 2-4 dev days
- M: 1-2 dev weeks
- L: 2-4 dev weeks

## 9.1 Milestone 1 - Foundation and Contracts (M)

Deliverables:

- Monorepo baseline and shared package boundaries
- Typed API contracts for auth, clients, analysis, consultations
- Auth module minimal vertical slice
- Localization baseline with auto-detect + manual override
- Client profile CRUD baseline
- Test harness and CI baseline

Dependencies:

- Product architecture approved
- Environment and secrets strategy agreed

Exit criteria:

- Core contracts published
- Auth and client CRUD running end-to-end
- Localization baseline verified
- CI green on unit and integration tests

## 9.2 Milestone 2 - Analysis and Consultation Core (L)

Deliverables:

- Photo upload pipeline
- Analysis orchestration and confidence flow
- Clarifying question loop
- Consultation composer and storage

Dependencies:

- Milestone 1 complete
- AI adapter contracts finalized

Exit criteria:

- Analysis returns structured output
- Low-confidence paths ask follow-up questions
- Consultation records persisted and retrievable

## 9.3 Milestone 3 - History, Calendar, Notifications (M)

Deliverables:

- Full client timeline
- Appointments and reminders
- Notification service baseline

Dependencies:

- Milestone 2 complete

Exit criteria:

- Timeline shows photos, formulas, treatments, consultations, appointments
- Reminder jobs execute reliably

## 9.4 Milestone 4 - Academy, Video, Marketplace (L)

Deliverables:

- Professional library taxonomy and content routes
- Video lesson recommendation and generation pipeline
- Supplier and product recommendations by country

Dependencies:

- Milestone 1 complete
- Worker and storage maturity

Exit criteria:

- Users can navigate full academy taxonomy
- Video lesson jobs complete and are viewable
- Marketplace returns localized supplier results

## 9.5 Milestone 5 - Billing, AI Agents, Hardening (L)

Deliverables:

- Subscription and billing integration hardening
- Multi-agent orchestration rollout
- Security, observability, and performance hardening

Dependencies:

- Milestones 2, 3, and 4 complete

Exit criteria:

- End-to-end commercial flow validated
- Agent orchestration stable under load
- Production readiness checklist passed

## 9.6 Milestone 6 - Multi-tenant, Analytics, Push Baseline (L)

Deliverables:

- Salon workspace and staff membership baseline
- Analytics snapshot APIs for consultations, reminders, and billing health
- Push notification preference and queue baseline

Dependencies:

- Milestone 5 complete

Exit criteria:

- Workspace-level access boundaries are enforced for salon users
- Analytics snapshot is available and consistent with persisted records
- Push queue accepts jobs and delivery state can be queried

## 9.7 Milestone 7 - Ops Governance, Backup, Retention (M)

Deliverables:

- Operations health snapshot and audit visibility APIs
- Backup snapshot baseline for user operational data
- Retention job baseline with dry-run and execution modes

Dependencies:

- Milestone 6 complete

Exit criteria:

- Ops health endpoint exposes stable operational counters
- Backups can be created and listed per authorized user
- Retention runs report affected records and enforce safe execution semantics

## 10. Risks and Mitigation

- AI uncertainty too high
  Mitigation: strict confidence thresholds, mandatory clarifying questions, fallback messaging.

- Scope expansion causes rework
  Mitigation: milestone gates, no cross-milestone spillover without approval.

- Data model drift
  Mitigation: contract-first development and migration reviews.

- Localization inconsistency
  Mitigation: centralized dictionary governance and locale tests.

- Payment integration regressions
  Mitigation: webhook simulation tests and contract monitoring.

## 11. Test Strategy and Acceptance Criteria

Test pyramid:

- Unit tests per module
- Contract tests for API schemas
- Integration tests for domain flows
- End-to-end tests for critical user journeys

Non-functional targets:

- API p95 response for core CRUD < 300ms (excluding AI)
- Analysis orchestration timeout policy and retries documented
- Error budget and logging coverage for critical modules

Milestone acceptance template:

- Functional: all listed stories pass
- Contract: API schema checks pass
- Data: migrations and constraints validated
- Security: auth and permission checks verified
- Quality: CI green and no blocker defects

## 12. Execution Control Protocol

- Build one milestone at a time.
- After each milestone is implemented and tested, stop.
- Wait for explicit approval before starting the next milestone.
- Do not implement Milestone N+1 while Milestone N is pending review.
- Any change request that affects architecture must update PRODUCT_ARCHITECTURE.md and this blueprint first.

## 13. Technical Architect Approval

Technical decision:

- This blueprint is approved as the implementation baseline.
- Implementation should start with Milestone 1 only.
- After Milestone 1 completion and test report, pause for approval before Milestone 2.
