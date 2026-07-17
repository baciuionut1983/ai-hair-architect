# Milestone 9 - Persisted E2E Test Setup

## Current Status

M9A implementation is **complete** but **persisted E2E validation is blocked** by the absence of a test PostgreSQL environment.

- ✓ Code implementation: complete
- ✓ Contract tests: 9/9 passing
- ✓ Unit tests: 77/77 passing
- ✓ Lint & typecheck: passing
- ⏸ Real E2E with persistence: **3 tests ready, blocked on DATABASE_URL**

## Prerequisites

A **separate PostgreSQL database** dedicated exclusively to E2E testing is required.

### Database Separation Requirements

- **Test database**: Isolated from development and production
- **Connection string**: `postgresql://user:password@host:port/database_name`
- **Test data**: Automatically created and destroyed per test run
- **Cleanup**: Automatic; no manual cleanup required between runs

## Setup Instructions

### 1. Configure Test Database Connection

Set the `DATABASE_URL` environment variable **only for test execution**:

```bash
export DATABASE_URL="postgresql://test_user:test_password@localhost:5432/ai_hair_architect_test"
```

**Do NOT commit this to `.env.local` or Git if using real credentials.**

For CI/CD environments, set `DATABASE_URL` via:
- GitHub Actions secrets
- Environment-specific configuration
- Test runner configuration

### 2. Apply Prisma Migrations

Run migrations on the test database:

```bash
export DATABASE_URL="postgresql://test_user:test_password@localhost:5432/ai_hair_architect_test"
npm run prisma:migrate:deploy
```

This creates all required tables and relationships without seed data.

### 3. E2E Test Seed Data

The test suite automatically creates required seed data via `tests/e2e/e2e-setup.ts`:

**Automatically created per test:**
- Professional user with session
- Salon user with session
- Consumer user with session (for rejection tests)
- Test client owned by professional user
- Additional users for ownership validation tests

**No manual seeding required** - the `setupE2ETestContext()` function handles all setup and cleanup.

### 4. Run Real Persisted E2E Tests

```bash
export DATABASE_URL="postgresql://test_user:test_password@localhost:5432/ai_hair_architect_test"
npm run test:e2e
```

This executes:
- **Contract tests** (9): `milestone9-contract-tests.spec.ts`
  - API authentication boundaries
  - File validation
  - UI smoke tests
  - No database required, pass on API structure alone

- **Real E2E tests** (3): `milestone9-real-e2e.spec.ts`
  - Complete workflow: upload → analyze → review → m8Draft → finalize M8 → reload → persistence verification
  - Consumer role rejection with 403
  - Cross-user ownership blocking with 403
  - Requires DATABASE_URL and running test database
  - Automatically creates and destroys test data

### 5. Expected Results

When DATABASE_URL is configured and PostgreSQL server is running:

```
Total E2E tests: 12
├─ Contract tests: 9/9 passed
└─ Real E2E tests: 3/3 passed
   ├─ Complete workflow (upload → persist)
   ├─ Role validation (consumer 403)
   └─ Ownership validation (cross-user 403)

Exit code: 0
```

## Test Data Lifecycle

### Per Test: Automatic Setup

Each real E2E test:
1. Creates dedicated user(s) with unique email (`e2e-test-{role}-{timestamp}@test.local`)
2. Creates session with Bearer token
3. Creates test client
4. Executes test operations

### Per Test: Automatic Cleanup

After each test completes:
1. Deletes all ImageAnalysisReview records
2. Deletes all ImageAnalysis records
3. Deletes all ImageAsset records
4. Deletes all Analysis (M8) records
5. Deletes test client
6. Deletes test session
7. Deletes test user

### Important: No Shared State

Tests are **fully isolated**. No data from one test affects another.

Test data contains **ONLY synthetic values**:
- Fake emails: `e2e-test-professional-1721245123456@test.local`
- Fake names: `Test Client {timestamp}`
- No real user data
- No production data

## Real E2E Test Verification

The 3 real E2E tests verify:

### Test 1: Complete Workflow Persistence

```
1. Upload file via /api/v1/uploads (real API call)
   → Asset saved to test database
   → Analysis created (draft status)

2. Review analysis via /api/v1/image-analyses/{assetId}/review
   → Corrections applied (hairType: curly, density: high)
   → Finalize to M8
   → M8 draft record created

3. Reload page
   → GET /api/v1/image-assets/{assetId} (retrieve from DB)
   → GET /api/v1/image-analyses/{assetId} (verify confirmed status)
   → Confirm: analysis.status = 'confirmed'
   → Confirm: analysis corrections persisted
   → Confirm: M8 draft fields match corrections

Result: Data verified as persisted in test database after reload ✓
```

### Test 2: Consumer Role Rejection

```
1. Create consumer user via setupE2ETestContext('consumer')
2. Attempt POST /api/v1/uploads with Bearer token
3. Verify: HTTP 403 Forbidden response
4. Verify: Error message indicates role not allowed

Result: Consumer role correctly blocked from uploads ✓
```

### Test 3: Cross-User Ownership

```
1. User A uploads file → assetId created in User A's ownership
2. User B attempts GET /api/v1/image-assets/{assetId}
3. Verify: HTTP 403 Forbidden response
4. Verify: User B cannot access User A's asset

Result: Ownership validation enforced ✓
```

## Critical Requirements

✓ **No mocking of M9A endpoints** in real E2E tests
- All API calls go to real running server
- All data written to and read from test database

✓ **Test data isolation**
- Automatic cleanup between tests
- No fixtures or hardcoded test data
- Each test creates fresh context

✓ **Repetability**
- Tests pass on first run
- Tests pass on 10th run
- Tests pass after database reset

✓ **No real data**
- Test emails use `.test.local` domain
- Test client names have timestamps
- No production data in test database

## Troubleshooting

### Error: "Can't reach database server at localhost:5432"

**Cause**: PostgreSQL not running or wrong connection string

**Fix**:
1. Verify PostgreSQL is running
2. Check `DATABASE_URL` for correct host, port, username, password
3. Verify test database exists: `psql -U user -h localhost -l | grep ai_hair_architect_test`

### Error: "relation \"User\" does not exist"

**Cause**: Migrations not applied to test database

**Fix**:
```bash
export DATABASE_URL="postgresql://test_user:test_password@localhost:5432/ai_hair_architect_test"
npm run prisma:migrate:deploy
```

### Tests pass but data not persisting after reload

**This should not happen** if real E2E tests are running correctly.

**Verify**:
1. Database connection is to test database (not mocked)
2. No route interception in Playwright (check `milestone9-real-e2e.spec.ts`)
3. Real API endpoints are being called (check network tab in test trace)

## Environment Variables

### Required for E2E tests:

```bash
DATABASE_URL="postgresql://test_user:test_password@localhost:5432/ai_hair_architect_test"
```

### NOT required in `.env.local` or Git:

- Real database credentials
- Production connection strings
- Hardcoded test data

### Recommended approach:

Store in:
- Local machine only (via shell profile or `.env.test` file in `.gitignore`)
- CI/CD secrets (GitHub Actions, etc.)
- Test runner configuration

## Next Steps

When PostgreSQL test environment becomes available:

1. Set `DATABASE_URL` environment variable
2. Run: `npm run prisma:migrate:deploy`
3. Run: `npm run test:e2e`
4. Verify all 12 tests pass (9 contract + 3 real E2E)
5. After confirmation, M9A is fully validated with persistence

---

**M9A Status**: Implementation complete; persisted E2E validation blocked by missing test PostgreSQL environment.
