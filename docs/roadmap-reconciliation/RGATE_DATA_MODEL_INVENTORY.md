# Prisma and Database Inventory

## 1. Blueprint Data Requirement Source
- TECHNICAL_IMPLEMENTATION_BLUEPRINT.md section 6 (Database Blueprint).

## 2. Repository Data Sources
- Schema: web/prisma/schema.prisma
- Migrations: web/prisma/migrations

## 3. Prisma Model Inventory
- User
- Session
- Client
- Analysis
- ImageAsset
- ImageAnalysis
- ImageAnalysisReview
- AuditLog
- OpsBackupSnapshot
- OpsBackupRestoreRun
- OpsBackupRestoreMaintenanceRun
- OpsBackupRestoreRetentionRun
- OpsRetentionRun
- OpsPushQueueEntry
- WebhookEndpoint
- WebhookEndpointSecretVersion
- WebhookEvent
- WebhookDelivery
- WebhookDeliveryAttempt

## 4. Migration Inventory
- 20260717_m8_analysis_persistence/migration.sql
- 20260717_m9_image_assets/migration.sql
- 20260718_add_audit_logging/migration.sql
- 20260718_init_users/migration.sql
- 20260719_add_webhook_endpoints/migration.sql
- 20260720_m10a_delivery_contracts/migration.sql
- 20260720_m10c_failed_terminal_timestamp/migration.sql
- 20260721_m12_ops_persistence/migration.sql
- 20260723_m13d_restore_run_history/migration.sql
- 20260723_m13e_restore_run_maintenance_indeterminate/migration.sql
- 20260723_m13f_restore_retention_governance/migration.sql

## 5. Requirement-to-Model Matrix

| Blueprint Table/Domain | Repository Evidence | Validation Evidence | Status |
|---|---|---|---|
| users | User model | auth route/runtime usage | complete |
| sessions | Session model | auth session flows and tests | complete |
| clients | Client model | client API and tests | complete |
| analysis_results / clarifications | Analysis model with lifecycle fields | milestone2 integration tests | partial |
| consultations | store-level evidence exists; no dedicated Prisma model in schema | consultation route and e2e flows | partial |
| client_photos | ImageAsset model | milestone9 persisted e2e | complete |
| color_formulas | formula route/store evidence, no dedicated Prisma model | timeline/formula tests limited | partial |
| treatment_records | treatments route/store evidence, no dedicated Prisma model | timeline/treatment tests limited | partial |
| appointments / reminders | appointments and notification routes, no dedicated Prisma appointment model | milestone3 tests | partial |
| products / suppliers / supplier_regions | route and store level evidence; no dedicated Prisma models | milestone4 tests | partial |
| subscriptions / payments | billing routes and tests; no dedicated Prisma models | milestone5 billing tests | partial |
| notifications | route/store evidence; no dedicated Prisma notification model | milestone3 notifications test | partial |
| audit_events | AuditLog model approximates requirement | audit integration tests | partial |
| organizations / user_roles | no Prisma model found | none | not implemented |

## 6. Data Contradictions and Gaps
- Blueprint key table list and current Prisma schema are not fully aligned.
- Repository uses hybrid persistence surfaces (Prisma plus in-memory/store-backed domains).
- Contradictions are tracked in RGATE_GAP_REGISTER.md.
