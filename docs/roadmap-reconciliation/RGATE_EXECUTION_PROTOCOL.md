# Roadmap Reconciliation Gate - Execution Protocol

## 1. Scope and Constraints
- Gate type: read-only reconciliation and documentation.
- Allowed outputs: only documents under docs/roadmap-reconciliation.
- Forbidden changes: functional code, API behavior, Prisma schema, migrations, tests, UI, runtime, staging, commit, push.

## 2. Source of Truth
- Blueprint requirements: TECHNICAL_IMPLEMENTATION_BLUEPRINT.md (sections 5, 6, 9, 11).
- Repository implementation: web/src/app/api/v1, web/prisma/schema.prisma, web/prisma/migrations, web/src/lib, web/tests.
- Historical evidence: docs/milestones, M9A_CLOSURE_REPORT.md, RAPORT_M9A_VERIFICARE_POSTGRESQL.md, git log.

## 3. Deterministic Classification Rules
- complete:
  - implementation evidence exists; and
  - validation evidence exists (test, integration, or milestone closing evidence).
- partial:
  - implementation evidence exists; but
  - validation evidence is incomplete, or requirement coverage is incomplete.
- unverified:
  - claim exists, but no direct technical evidence is found in code/tests/schema/migrations.
- not implemented:
  - blueprint requires it, and no implementation evidence is found.
- not applicable:
  - item is outside this gate scope or outside applicable blueprint milestone requirement.

Additional rule:
- Endpoint/model/file existence alone is not sufficient for complete.

## 4. Validation Workflow
1. Extract blueprint API, DB, milestone, and acceptance requirements.
2. Inventory repository API routes.
3. Inventory Prisma models and migration history.
4. Inventory tests and named evidence.
5. Build blueprint-to-internal mapping matrix for M8-M13.
6. Build API, data, and test coverage matrices.
7. Evaluate production readiness checklist.
8. Register all contradictions between blueprint, docs, and code in gap register.
9. Produce closure report with PASS/FAIL and single next milestone recommendation.

## 5. Read-only Verification Commands
All commands are executed from repository root.

- Select-String -Path "TECHNICAL_IMPLEMENTATION_BLUEPRINT.md" -Pattern "^## 9\.[1-7]|^## 5\.|^## 6\.|^## 11\.|production readiness checklist|Milestone 5"
- Get-ChildItem -Recurse -File "web/src/app/api/v1" | ForEach-Object { $_.FullName }
- Select-String -Path "web/prisma/schema.prisma" -Pattern "^model\s+"
- Get-ChildItem -Recurse -File "web/prisma/migrations" | ForEach-Object { $_.FullName }
- Select-String -Path "web/tests/integration/*.ts","web/tests/e2e/*.ts","web/src/lib/*.test.ts" -Pattern "suite\(|describe\(|it\("
- git log --oneline -n 30
- git diff --check
- git status --short --untracked-files=all

## 6. Acceptance Criteria
- Exactly 8 new gate documents exist in docs/roadmap-reconciliation.
- No existing file is modified.
- Every mandatory blueprint requirement is classified.
- Every complete classification has both implementation and validation evidence.
- M11 remains unverified unless direct technical evidence beyond naming/claims is present.
- All contradictions are recorded in RGATE_GAP_REGISTER.md.
- Closure report contains PASS/FAIL, summary counts, mandatory gaps, and one recommendation.

## 7. Risk Controls
- No retroactive closure claims are added without technical evidence.
- No inferred complete statuses are allowed.
- Conflicts between blueprint and repository are preserved as explicit gaps.
- Evidence must use repository-relative paths and named tests/migrations/commits where possible.

## 8. Sign-off Checklist
- [ ] Manifest count verified: 8 new files.
- [ ] Existing files modified: 0.
- [ ] Git staging performed: no.
- [ ] Commit/push performed: no.
- [ ] Gate verdict emitted with evidence-backed summary.
