This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Testing

### Unit Tests

```bash
npm run test              # Run all unit tests once
npm run test:watch       # Watch mode
```

Runs 77 tests across 32 test files using Vitest.

### E2E Tests

#### Contract & Smoke Tests (9 tests) - No Database Required

```bash
npm run test:e2e
```

Verifies:
- API authentication boundaries (401/403 responses)
- File upload validation (MIME types, magic bytes)
- UI smoke tests (pages load)

**No database needed** - tests verify API contracts, not persistence.

#### Real Persisted E2E Tests (3 tests) - Requires PostgreSQL

```bash
# 1. Setup test database (one time)
npm run db:test:setup

# 2. Apply migrations
npm run db:test:migrate

# 3. Set environment variable (each session)
$env:TEST_DATABASE_URL = "postgresql://test_user:test_pass@localhost:5432/ai_hair_architect_test"

# 4. Run real persisted E2E tests
npm run test:e2e:real
```

Verifies:
- Complete workflow: upload → analyze → review → m8 draft → finalize M8 → reload → **persistence**
- Consumer role rejection with 403 Forbidden
- Cross-user ownership blocking with 403 Forbidden
- Data persists in database after browser reload

**Requires** PostgreSQL test database (separate from development)

**Setup Guide**: [`../docs/POSTGRES_SETUP.md`](../docs/POSTGRES_SETUP.md)

### Linting & Type Checking

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript type checking
npm run build       # Full Next.js build
```

### Test Database Management

```bash
# Validate test database connection
npm run db:test:validate

# Create test database (first time only)
npm run db:test:setup

# Apply Prisma migrations to test database
npm run db:test:migrate

# Reset test database (drops and recreates)
npm run db:test:reset
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
