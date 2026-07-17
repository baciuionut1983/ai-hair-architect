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

#### Contract & Smoke Tests (9 tests)

```bash
npm run test:e2e
```

Verifies API contract boundaries and UI smoke tests. Does not require database persistence.

#### Real Persisted E2E Tests (3 tests)

Requires separate PostgreSQL test database and `DATABASE_URL` environment variable.

**Status**: ⏸ Blocked - awaiting test PostgreSQL environment

For setup instructions, see: [`docs/M9_E2E_TEST_SETUP.md`](docs/M9_E2E_TEST_SETUP.md)

### Linting & Type Checking

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript type checking
npm run build       # Full Next.js build
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
