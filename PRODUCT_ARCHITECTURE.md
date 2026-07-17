# AI Hair Architect - Product and AI Architecture Document

Status: Draft for review

Scope: This document defines the complete product vision, functional modules, user flows, technical architecture, data model, AI agent system, and version roadmap for AI Hair Architect. It does not modify application code.

## 1. Product Vision

AI Hair Architect is a professional AI platform for hairstylists, salon owners, educators, product vendors, and advanced consumers. The product acts as an intelligent assistant for hair analysis, consultation, technical decision support, client management, education, and commercial workflows.

### 1.1 Core value proposition

- Turn a client photo and a few questions into a structured hair plan.
- Help professionals choose safer, better technical decisions for cut, color, lightening, treatment, and styling.
- Keep a complete client history across photos, formulas, services, recommendations, and follow-ups.
- Combine education, business, and marketplace workflows in a single system.
- Adapt the experience to the user's role, language, country, and salon/business context.

### 1.2 Primary user segments

- Professional stylist
- Salon owner
- Color specialist
- Hair treatment specialist
- Educator or trainer
- Product vendor / retailer
- Advanced consumer

### 1.3 Product principles

- AI assists, but does not silently override professional judgment.
- Every AI recommendation should be explainable.
- High-risk decisions must request additional questions when confidence is low.
- Client data must be organized, searchable, and historically traceable.
- The UI should adapt to role, language, location, and experience level.
- The system should evolve without deleting legacy logic until parity is verified.
- Before any implementation, future work must read and follow this document as the project constitution.

## 2. Product Scope by Capability

### 2.1 Identity and access

- Sign up and sign in
- Role-based access
- Guest preview mode
- Session handling
- Subscription gating
- Trial, free, pro, salon, and business tiers

### 2.2 Hair analysis and consultation

- Photo upload and camera capture
- Hair type, density, porosity, scalp condition, and visible damage assessment
- Face and head shape support
- Goal selection: refresh, cover gray, lighten, correct, reshape, treat
- AI confidence scoring
- Follow-up questions when confidence is low
- Clarifying flow when the model is uncertain about texture, chemical history, scalp sensitivity, or service risk
- Structured output for cut, color, treatment, and care recommendations

### 2.3 Technical recommendation engine

- Cut recommendations
- Color recommendations
- Bleaching / lightening safety guidance
- Treatment recommendations
- Product suggestions
- Risk flags and contraindications
- Step-by-step technical plans

### 2.4 Client history and CRM

- Client profiles
- Visit history
- Photo history
- Formula history
- Treatment history
- Appointment history
- Notes and attachments
- Next-visit reminders
- Search and filtering
- Service chronology with timestamps and outcome tracking

### 2.5 Education and academy

- Structured hair library
- Tutorials by category
- Video lessons
- Decision trees
- Technique comparisons
- Business education and product education
- Demonstration video generation and curated learning paths

### 2.5.1 Professional library taxonomy

The professional library must be organized at minimum into these sections:

- Haircuts: women, men, short, medium, long, fades, precision shapes
- Color: gloss, permanent, demi-permanent, root shadow, balayage, correction, gray coverage
- Lightening / bleaching: lift levels, safety, foils, sectioning, toning, contraindications
- Styling / coafuri: daily styling, event styling, waves, updos, brushing, finishing
- Extensions: clip-in, tape-in, keratin bond, microring, weft, maintenance
- Treatments: hydration, repair, detox, scalp care, bonding, post-color recovery
- Keratin: indication, contraindication, protocol, aftercare, heat control
- Washing and cleansing: scalp types, shampoo selection, washing technique, post-wash behavior
- Products: shampoo, conditioner, mask, leave-in, heat protection, styling, treatment boosters

### 2.6 Marketplace and suppliers

- Product catalog
- Local supplier directory
- Country-aware supplier suggestions
- Brand and retailer placement
- Product linking
- Sponsored listings
- Country-localized product availability, language, shipping, tax, and currency awareness
- Supplier ranking by country, city, category, and relevance to the client plan

### 2.7 Calendar and workflow

- Appointment scheduling
- Consultation reminders
- Follow-up reminders
- Treatment cycle reminders
- Patch test and rebook reminders
- Integration with client history so appointments are visible in the full chronology

### 2.8 Notifications

- In-app notifications
- Email notifications
- Push notifications later
- Reminder lifecycle management
- AI-driven reminders for maintenance, follow-up, rebooking, and education completion

## 3. Current-State Audit Summary

This section summarizes the current product state based on the existing legacy app and the current Next.js migration.

### 3.1 What exists in the legacy app

- Multi-section navigation
- Language switching
- Role mode switching
- Auth and session logic
- Photo upload and analysis recommendation flow
- Product shortlist
- Client cards
- Direct debit / billing flow
- Subscription reminders
- Suppliers module
- Extension companion module
- Detailed tutorials and education content
- Calendar and community concepts

### 3.2 What exists in the current Next.js UI

- Header with limited navigation
- Basic hair analysis selectors
- Static academy section
- Simplified product vision intro

### 3.3 Gaps in the current Next.js UI

- Authentication UI and session logic
- Advanced billing and direct debit UX
- Photo analysis workflow
- Client CRM screens
- Product shortlist and suppliers
- Extension companion entry point
- Tutorials and lesson modules
- Language switcher
- Role-based UI adaptation

## 4. Functional Modules

### 4.1 Auth Module

Purpose: user identity, access control, tier management, session safety.

Functions:

- Sign in / sign up
- Guest access
- Role selection
- Session expiration
- Permission checks

### 4.2 Profile and Role Module

Purpose: adapt experience to user type.

Roles:

- Professional stylist
- Salon owner
- Color specialist
- Treatment specialist
- Educator
- Vendor
- Consumer

### 4.3 Multilingual Module

Purpose: support localized language and regional content.

Functions:

- Automatic language detection
- Manual language switch
- Localized copy
- Localized academy content
- Localized supplier suggestions
- Language fallback rules when the browser language is unsupported
- Region-aware terminology so technical wording matches local salon vocabulary
- Preservation of the user-selected language across sessions

### 4.4 Hair Analysis Module

Purpose: assess hair and scalp from images and user inputs.

Inputs:

- Client photo
- Hair type
- Density
- Porosity
- Scalp condition
- Goal

Outputs:

- Hair profile
- Risk flags
- Confidence score
- Clarifying questions
- Multi-step analysis output that can stop and ask for more information before giving a risky recommendation

### 4.5 Consultation Module

Purpose: convert analysis into a structured consultation workflow.

Functions:

- Question collection
- Recommendation explanation
- Contraindication check
- Consultation summary
- Risk escalation when the analysis confidence or history completeness is below threshold
- Human-readable explanation of why the system asked for additional information

### 4.6 Client History Module

Purpose: persist all important client information.

Stored history:

- Photos
- Consultations
- Color formulas
- Treatments
- Haircuts
- Notes
- Product recommendations
- Follow-up outcomes
- Appointments
- AI confidence snapshots and decision notes
- Before/after comparisons when available

### 4.7 Haircut Technique Module

Purpose: guide haircut choice and execution.

Areas:

- Women's cuts
- Men's cuts
- Layering
- Texture control
- Precision shapes

### 4.8 Color Expert Module

Purpose: guide color decisions and formula strategy.

Areas:

- Gray coverage
- Gloss and refresh
- Root shadow
- Balayage
- Foils
- Toners
- Color correction

### 4.9 Hair Treatment Module

Purpose: guide treatment choice and maintenance.

Areas:

- Hydration
- Repair
- Keratin
- Bonding
- Scalp care
- Heat protection
- Treatment contraindications and post-service care plans

### 4.10 Product Advisor Module

Purpose: suggest tools and products based on the client's needs.

Functions:

- Recommend products by goal
- Match local availability
- Save shortlist
- Compare alternatives
- Rank by country, price band, availability, and service compatibility

### 4.11 Video Lesson Module

Purpose: teach techniques with structured learning content.

Functions:

- Lesson playback
- Chapter markers
- Technique steps
- Related products and warnings
- Video lesson generation from structured outlines when source content exists
- Demo-style micro lessons for quick technique review

### 4.12 Business Coach Module

Purpose: support salon business decisions.

Functions:

- Pricing guidance
- Retention ideas
- Upsell suggestions
- Service bundles
- Subscription and marketplace strategy

## 5. User Flows

### 5.1 First-time user flow

1. Open app.
2. Auto-detect language and region.
3. Choose role or continue as guest.
4. See access level and onboarding.
5. Upload photo or start demo analysis.
6. Receive guidance, recommendation, and next steps.
7. If the system is uncertain, answer follow-up questions before continuing.

### 5.2 Professional consultation flow

1. Search or create client.
2. Add photo and consultation inputs.
3. Run AI analysis.
4. Answer clarifying questions if requested.
5. Review cut, color, treatment, and product recommendations.
6. Save formulas, notes, and follow-up tasks.
7. Add appointments and reminders to the client timeline.

### 5.3 Color service flow

1. Load client history.
2. Review previous color formulas and outcomes.
3. Analyze current base and condition.
4. Compare options and risk levels.
5. Produce formula plan and maintenance plan.

### 5.4 Treatment flow

1. Detect damage, porosity, and scalp condition.
2. Recommend treatment category.
3. Explain protocol and maintenance.
4. Save treatment history and next review date.

### 5.5 Marketplace flow

1. Detect country and location.
2. Load local vendor suggestions.
3. Rank products by relevance.
4. Allow save to shortlist.
5. Link products to recommendation or service plan.
6. Localize suppliers, shipping, and payment context to the user's country.

## 6. Technical Architecture

### 6.1 Frontend architecture

- Next.js App Router
- Component-based domain modules
- Shared design system
- Role-aware navigation and UI state
- Localized routes or locale-aware state
- Lazy loading for heavy modules such as video or AI analysis

### 6.2 Backend architecture

- API layer for auth, client data, analysis, billing, marketplace, and notifications
- AI orchestration layer
- Database access layer
- File storage service for images and video
- Background jobs for reminders and async AI tasks

### 6.3 AI orchestration architecture

- One orchestrator routes requests to specialized agents
- Agents produce structured outputs, not raw UI text only
- Confidence scores determine whether more questions are required
- Safety rules block risky recommendations without enough data

### 6.4 Recommended system boundaries

- UI layer
- Domain services layer
- AI services layer
- Persistence layer
- Integration layer
- Notification layer
- Billing layer

## 7. Database Model

Below is the recommended logical model.

### 7.1 Core entities

- users
- roles
- sessions
- organizations or salons
- clients
- client_photos
- consultations
- analysis_results
- hair_profiles
- analysis_questions
- analysis_confidence_snapshots
- color_formulas
- treatment_plans
- treatment_history
- haircut_plans
- product_recommendations
- product_shortlists
- suppliers
- appointments
- appointment_reminders
- notifications
- lessons
- video_lessons
- subscriptions
- payments
- audit_logs

### 7.2 Suggested relationships

- A user belongs to one or more organizations.
- A client belongs to one organization or one user context.
- A client has many photos, consultations, formulas, treatments, and appointments.
- An analysis result can produce many recommendations.
- A recommendation can reference products, lessons, and warnings.
- A subscription belongs to a user or organization.
- A notification belongs to a user and may reference a client or appointment.

### 7.3 Important fields

Users:

- id
- email
- password_hash
- role
- language
- country
- created_at
- updated_at

Clients:

- id
- owner_user_id
- organization_id
- full_name
- phone
- email
- notes
- preferred_language
- created_at
- updated_at

Client photos:

- id
- client_id
- image_url
- capture_source
- face_visibility_score
- analysis_status
- created_at

Consultations:

- id
- client_id
- user_id
- summary
- confidence_score
- follow_up_questions_json
- decision_rationale_json
- created_at

Color formulas:

- id
- client_id
- service_date
- base_level
- target_level
- formula_json
- developer_notes
- result_summary
- service_context_json

Treatments:

- id
- client_id
- type
- product_list_json
- protocol_json
- maintenance_json
- contraindications_json
- follow_up_review_date

Suppliers:

- id
- country
- city
- name
- category
- website
- featured
- currency
- shipping_regions_json

Subscriptions:

- id
- user_id
- plan
- status
- billing_provider
- renewal_date

Appointments:

- id
- client_id
- user_id
- title
- service_type
- starts_at
- ends_at
- status
- reminder_policy_json

## 8. AI Agent System

The AI layer should be composed of specialized agents plus one orchestrator.

### 8.1 Orchestrator

Role:

- Receives user request.
- Routes to the right agent or combination of agents.
- Merges outputs into a consultation package.
- Decides whether clarification is required.
- Preserves a decision trace so the system can explain how the final recommendation was produced.

### 8.2 Hair Analysis Agent

Purpose: analyze photo, hair condition, and visible signs of damage.

Inputs:

- image
- hair type fields
- density
- porosity
- scalp condition

Outputs:

- hair profile
- damage assessment
- uncertainty flags
- follow-up questions
- confidence report with reasons for uncertainty

### 8.3 Haircut Technique Agent

Purpose: propose haircut direction and technique.

Outputs:

- shape recommendation
- sectioning notes
- finishing guidance
- warnings for unsuitable choices
- technique comparison when multiple cuts are viable

### 8.4 Color Expert Agent

Purpose: generate color strategy and formula logic.

Outputs:

- formula direction
- color correction warnings
- toner guidance
- maintenance plan
- service-safe plan with risk notes and before/after expectation summary

### 8.5 Hair Treatment Agent

Purpose: suggest treatment plans.

Outputs:

- treatment category
- protocol
- aftercare
- contraindications
- follow-up and review guidance

### 8.6 Consultation Agent

Purpose: unify the overall client consultation.

Outputs:

- consultation summary
- next questions
- decision checklist
- client-ready explanation of the final plan

### 8.7 Client History Agent

Purpose: inspect past history and detect patterns.

Outputs:

- summary of previous services
- repeated risks
- successful patterns
- timeline of photos, formulas, services, and appointments

### 8.8 Product Advisor Agent

Purpose: match products to service and local availability.

Outputs:

- product shortlist
- local alternatives
- professional upsell suggestions
- country-aware ranking of products and vendors

### 8.9 Video Lesson Agent

Purpose: recommend the most useful educational content.

Outputs:

- lesson list
- lesson priority
- skill level fit
- suggestion for generating or updating a lesson from the underlying knowledge base

### 8.10 Business Coach Agent

Purpose: support revenue and operational decisions.

Outputs:

- pricing ideas
- retention plan
- service bundle suggestions
- subscription upgrade advice
- regional business suggestions based on the user's country and salon context

### 8.11 Agent collaboration rules

- Analysis agent feeds consultation agent.
- History agent enriches color and treatment decisions.
- Color and haircut agents should not override safety constraints.
- Product advisor only proposes products after service direction is known.
- Business coach should never change clinical or technical advice.
- If the analysis confidence is low, the orchestrator must request additional questions before finalizing the recommendation.

## 9. Product Roadmap

### 9.1 MVP

Scope:

- Sign in and guest preview
- Language detection and manual language switch
- Photo upload and basic AI analysis
- Simple follow-up questions when uncertain
- Client profile and history
- Basic color, haircut, and treatment recommendations
- Basic academy
- Basic billing / plan awareness
- Auto-detected language with manual override
- Explicit hair analysis questions when confidence is low

Goal:

- Prove the consultation workflow and core AI usefulness.

Dependencies:

- Auth and role model
- Localization foundation
- Client profile and history basics
- Image upload and storage

Estimated effort:

- Medium

### 9.2 Version 2

Scope:

- Full client CRM
- Photo history
- Formula history
- Treatment history
- Calendar and reminders
- Product shortlist
- Vendor directory by country
- Improved localization
- Calendar-aware follow-up reminders
- Appointment history in the client timeline

Goal:

- Turn the app into a real professional workflow tool.

Dependencies:

- MVP completed and stable
- Client timeline persisted in the database
- Supplier country normalization
- Notification service

Estimated effort:

- Large

### 9.3 Version 3

Scope:

- AI agent system
- Intelligent recommendation routing
- Business coach module
- Video lesson engine
- Advanced consultation summaries
- Deeper safety and confidence logic
- Demo and lesson generation pipeline

Goal:

- Make the system behave like a coordinated AI assistant platform.

Dependencies:

- Stable client history and consultation data
- Recommendation engine foundation
- Content model for lessons and media
- AI orchestrator and agent contracts

Estimated effort:

- Large

### 9.4 Version 4

Scope:

- Marketplace monetization
- Subscription tiers
- Vendor dashboards
- Advanced analytics
- Personalization engine
- Push notifications
- Multi-tenant salon support

Goal:

- Transform the product into a scalable commercial platform.

Dependencies:

- Mature billing and subscription system
- Marketplace data model
- Notification infrastructure
- Multi-tenant permissions and reporting

Estimated effort:

- Large

### 9.5 Version 5

Scope:

- Multi-tenant salon workspaces with staff-level boundaries
- Analytics snapshots for operational and commercial health
- Push notification baseline with preference controls and delivery queue

Goal:

- Move from validated vertical slices to scalable salon operations readiness.

Dependencies:

- Billing and subscription lifecycle hardening
- Agent orchestration baseline
- Notification module and reminder pipelines

Estimated effort:

- Large

### 9.6 Version 6

Scope:

- Operational governance snapshots for system health and audit visibility
- Backup baseline for core operational artifacts
- Retention jobs with dry-run safeguards and explicit execution mode

Goal:

- Increase operational safety and lifecycle governance without breaking validated workflows.

Dependencies:

- Multi-tenant workspace baseline
- Analytics and notification baselines
- Billing and audit event pipelines

Estimated effort:

- Medium

## 10. Implementation Strategy

### 10.1 What to keep

- Existing legacy behavior as a reference source
- Existing Next.js scaffold as the new front-end foundation
- Existing backend checkout and subscription endpoints as temporary integration baseline

### 10.2 What to rebuild

- Auth and session UX
- Complete analysis workflow
- CRM and history model
- Marketplace and suppliers
- Tutorials and academy
- Multi-language and role-based UI
- AI agent orchestration

### 10.3 Build order

1. Authentication and role model
2. Client profile and history
3. Analysis workflow with follow-up questions
4. Color, haircut, and treatment recommendation services
5. Calendar and notifications
6. Academy and video lessons
7. Marketplace and supplier layer
8. AI agents and orchestration

## 11. Risks and Constraints

- AI analysis may be uncertain without good image quality.
- Color and bleaching suggestions can be high risk and must be safety constrained.
- Marketplace and supplier data vary by country and need regional normalization.
- Video content requires a separate content model and delivery strategy.
- Legacy logic may overlap with Next.js migration and should be reconciled carefully.
- Product scope is intentionally broad, so implementation must be staged to avoid partial, inconsistent UX.

## 12. Documentation Governance

This section defines how future implementation work must use this document.

- Any future AI coding assistant must read this document before proposing code changes.
- If a proposed change conflicts with this document, the document wins until it is explicitly updated.
- If a feature is not listed here, it must be treated as out of scope until approved.
- Before implementation, update this document first, then derive the technical plan, then code.
- Changes to architecture, data model, or AI agent behavior must be reflected here before implementation begins.

## 13. Approval Decision Needed

This document is intended to be the approved blueprint before implementation starts.

Recommended next approval step:

- Confirm product scope.
- Confirm MVP boundaries.
- Confirm AI agent boundaries.
- Confirm database direction.
- Confirm which legacy behaviors must be preserved first.
