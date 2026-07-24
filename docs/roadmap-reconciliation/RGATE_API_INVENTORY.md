# API Inventory and Blueprint Coverage Matrix

## 1. Blueprint API Requirement Source
- TECHNICAL_IMPLEMENTATION_BLUEPRINT.md section 5.1 to 5.10.

## 2. Repository API Surface Source
- Directory scan: web/src/app/api/v1

## 3. Coverage Matrix

| Blueprint API Requirement | Repository Evidence | Validation Evidence | Status |
|---|---|---|---|
| POST /auth/register | web/src/app/api/v1/auth/register/route.ts | route behavior covered by auth flows and test suites using authenticated contexts | complete |
| POST /auth/login | web/src/app/api/v1/auth/login/route.ts | route behavior covered by auth/session usage across integration tests | complete |
| POST /auth/logout | web/src/app/api/v1/auth/logout/route.ts | web/src/app/api/v1/auth/logout/route.test.ts; web/tests/integration/auth-session-revocation.integration.test.ts | complete |
| GET /auth/me | web/src/app/api/v1/auth/me/route.ts | route used in authenticated UI/runtime paths | complete |
| GET /clients | web/src/app/api/v1/clients/route.ts | milestone store and integration tests rely on clients retrieval | complete |
| POST /clients | web/src/app/api/v1/clients/route.ts | client creation exercised in integration setup paths | complete |
| GET /clients/:id | web/src/app/api/v1/clients/[id]/route.ts | route availability plus client ownership flows in tests | complete |
| PATCH /clients/:id | web/src/app/api/v1/clients/[id]/route.ts | update path present and exercised in milestone tests | complete |
| POST /clients/:id/photos | web/src/app/api/v1/clients/[id]/photos/route.ts | image and timeline flows in milestone9 tests | complete |
| GET /clients/:id/timeline | web/src/app/api/v1/clients/[id]/timeline/route.ts | web/src/lib/milestone3-timeline.test.ts | complete |
| POST /analysis/start | web/src/app/api/v1/analysis/start/route.ts | web/src/lib/milestone2-integration.test.ts | complete |
| POST /analysis/:id/clarify | web/src/app/api/v1/analysis/[id]/clarify/route.ts | web/src/lib/milestone2-integration.test.ts | complete |
| GET /analysis/:id/result | web/src/app/api/v1/analysis/[id]/result/route.ts | milestone2 tests and runtime flow | complete |
| POST /consultations | web/src/app/api/v1/consultations/route.ts | milestone2 and milestone9 flows | complete |
| GET /consultations/:id | web/src/app/api/v1/consultations/[id]/route.ts | web/src/app/api/v1/consultations/[id]/route.test.ts; web/tests/integration/consultations-ownership.integration.test.ts | complete |
| GET /clients/:id/consultations | web/src/app/api/v1/clients/[id]/consultations/route.ts | milestone2 panel + tests | complete |
| POST /clients/:id/formulas | web/src/app/api/v1/clients/[id]/formulas/route.ts | timeline/history tests include formula flows | partial |
| GET /clients/:id/formulas | web/src/app/api/v1/clients/[id]/formulas/route.ts | same as above | partial |
| POST /clients/:id/treatments | web/src/app/api/v1/clients/[id]/treatments/route.ts | timeline/history tests include treatment flows | partial |
| GET /clients/:id/treatments | web/src/app/api/v1/clients/[id]/treatments/route.ts | same as above | partial |
| GET /academy/categories | web/src/app/api/v1/academy/categories/route.ts | web/src/lib/milestone4-academy.test.ts | complete |
| GET /academy/lessons | web/src/app/api/v1/academy/lessons/route.ts | web/src/lib/milestone4-academy.test.ts | complete |
| GET /academy/lessons/:id | web/src/app/api/v1/academy/lessons/[id]/route.ts | web/src/lib/milestone4-academy.test.ts | complete |
| POST /video-lessons/generate | web/src/app/api/v1/video-lessons/generate/route.ts | web/src/lib/milestone4-video.test.ts | complete |
| GET /video-lessons/:id | web/src/app/api/v1/video-lessons/[id]/route.ts | web/src/lib/milestone4-video.test.ts | complete |
| GET /products | web/src/app/api/v1/products/route.ts | web/src/lib/milestone4-marketplace.test.ts | complete |
| GET /suppliers | web/src/app/api/v1/suppliers/route.ts | web/src/lib/milestone4-marketplace.test.ts | complete |
| GET /suppliers/recommended | web/src/app/api/v1/suppliers/recommended/route.ts | web/src/lib/milestone4-marketplace.test.ts | complete |
| POST /shortlists | web/src/app/api/v1/shortlists/route.ts | web/src/lib/milestone4-marketplace.test.ts | complete |
| POST /billing/checkout | web/src/app/api/v1/billing/checkout/route.ts | web/src/lib/milestone5-billing.test.ts | complete |
| POST /billing/webhook | web/src/app/api/v1/billing/webhook/route.ts | webhook and billing tests | partial |
| GET /billing/subscription | web/src/app/api/v1/billing/subscription/route.ts | web/src/lib/milestone5-billing.test.ts | complete |
| GET /notifications | web/src/app/api/v1/notifications/route.ts | web/src/lib/milestone3-notifications.test.ts | complete |
| POST /notifications/read | web/src/app/api/v1/notifications/read/route.ts | web/src/lib/milestone3-notifications.test.ts | complete |
| POST /appointments | web/src/app/api/v1/appointments/route.ts | milestone3 tests | complete |
| GET /appointments | web/src/app/api/v1/appointments/route.ts | milestone3 tests | complete |

## 4. Required Gaps
- No remaining mandatory API route gaps from blueprint section 5.1 to 5.10.

## 5. Contradictions Logged
- Historical contradictions C-001 and C-002 are resolved by implemented routes and test evidence.
- Remaining active contradictions are tracked in RGATE_GAP_REGISTER.md.
