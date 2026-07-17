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
  const email = `e2e-test-${role}-${Date.now()}@test.local`;
  const passwordHash = 'test-hash-' + Date.now();

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      locale: 'en',
    },
  });

  // Create session
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
      name: `Test Client ${Date.now()}`,
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

export async function cleanupE2ETestContext(context: TestContext): Promise<void> {
  // Delete in order to respect foreign keys
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

  await prisma.$disconnect();
}
