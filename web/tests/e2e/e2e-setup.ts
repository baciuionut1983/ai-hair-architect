import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export interface TestContext {
  userId: string;
  token: string;
  clientId: string;
  role: string;
  email: string;
}

export async function setupE2ETestContext(role: 'professional' | 'salon'): Promise<TestContext> {
  // Generate truly unique identifier per test using UUID + timestamp for readability
  const uniqueId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const timestamp = Date.now();
  const email = `e2e-test-${role}-${uniqueId}-${timestamp}@test.local`;
  const passwordHash = `test-hash-${uniqueId}`;

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      locale: 'en',
    },
  });

  // Create session with unique random token
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Create client
  const client = await prisma.client.create({
    data: {
      name: `Test Client ${uniqueId}`,
      ownerUserId: user.id,
    },
  });

  return {
    userId: user.id,
    token,
    clientId: client.id,
    role,
    email,
  };
}

export async function cleanupE2ETestContext(context: TestContext | undefined): Promise<void> {
  // Handle undefined context safely (test setup may fail before context is created)
  if (!context) {
    return;
  }

  try {
    // Delete in order to respect foreign key constraints
    // Use deleteMany to be idempotent - non-existent records don't block cleanup

    await prisma.imageAnalysisReview.deleteMany({
      where: {
        analysis: {
          asset: {
            ownerUserId: context.userId,
          },
        },
      },
    });

    await prisma.imageAnalysis.deleteMany({
      where: {
        asset: {
          ownerUserId: context.userId,
        },
      },
    });

    await prisma.imageAsset.deleteMany({
      where: {
        ownerUserId: context.userId,
      },
    });

    await prisma.analysis.deleteMany({
      where: {
        ownerUserId: context.userId,
      },
    });

    await prisma.client.deleteMany({
      where: {
        ownerUserId: context.userId,
      },
    });

    await prisma.session.deleteMany({
      where: {
        userId: context.userId,
      },
    });

    await prisma.user.delete({
      where: {
        id: context.userId,
      },
    });
  } finally {
    // Always disconnect, even if cleanup partially fails
    await prisma.$disconnect();
  }
}
