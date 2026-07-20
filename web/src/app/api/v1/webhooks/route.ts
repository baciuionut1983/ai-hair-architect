import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from '@/middleware/analytics-auth';
import { generateSecret, encryptSecret, getMasterKeyFromEnv } from '@/lib/webhook-crypto';
import { validateWebhookUrl, resolveDnsAndValidate } from '@/lib/webhook-validator';

export async function POST(req: NextRequest) {
  try {
    const user = await validateAnalyticsAccess(req);

    const body = await req.json();
    const { name, url } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'NAME_REQUIRED', status: 400, message: 'name is required' },
        { status: 400 },
      );
    }

    if (name.length > 255) {
      return NextResponse.json(
        { error: 'NAME_TOO_LONG', status: 400, message: 'name must be 255 characters or less' },
        { status: 400 },
      );
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL_REQUIRED', status: 400, message: 'url is required' },
        { status: 400 },
      );
    }

    const isDevelopment = process.env.NODE_ENV === 'development';

    const urlValidation = validateWebhookUrl(url, isDevelopment);
    if (!urlValidation.valid) {
      const errorCode = urlValidation.error || 'URL_INVALID';
      return NextResponse.json(
        { error: errorCode, status: 400, message: `URL validation failed: ${errorCode}` },
        { status: 400 },
      );
    }

    const parsedUrl = new URL(url);
    const dnsValidation = await resolveDnsAndValidate(parsedUrl.hostname, isDevelopment);
    if (!dnsValidation.valid) {
      const errorCode = dnsValidation.error || 'URL_VALIDATION_FAILED';
      return NextResponse.json(
        { error: errorCode, status: 400, message: `URL validation failed: ${errorCode}` },
        { status: 400 },
      );
    }

    let masterKey;
    try {
      masterKey = getMasterKeyFromEnv();
    } catch {
      console.error('Encryption key error');
      return NextResponse.json(
        { error: 'ENCRYPTION_UNAVAILABLE', status: 500, message: 'Webhooks service unavailable' },
        { status: 500 },
      );
    }

    const plainSecret = generateSecret();

    let secretEncrypted;
    try {
      secretEncrypted = encryptSecret(plainSecret, user.id, masterKey);
    } catch {
      console.error('Encryption error');
      return NextResponse.json(
        { error: 'ENCRYPTION_ERROR', status: 500, message: 'Failed to encrypt webhook secret' },
        { status: 500 },
      );
    }

    const webhook = await prisma.webhookEndpoint.create({
      data: {
        ownerUserId: user.id,
        name,
        url,
        secretEncrypted,
        enabled: true,
      },
    });

    return NextResponse.json(
      {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        enabled: webhook.enabled,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
        secret: plainSecret,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', status: 400, message: 'Invalid request body' },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error('POST /webhooks error:', message);

    if (message.includes('Unique constraint failed')) {
      return NextResponse.json(
        { error: 'DUPLICATE_NAME', status: 409, message: 'Webhook name already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await validateAnalyticsAccess(req);

    const url = new URL(req.url);
    const limitStr = url.searchParams.get('limit') || '50';
    const offsetStr = url.searchParams.get('offset') || '0';

    const limit = parseInt(limitStr, 10);
    const offset = parseInt(offsetStr, 10);

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'INVALID_LIMIT', status: 400, message: 'limit must be between 1 and 100' },
        { status: 400 },
      );
    }

    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        { error: 'INVALID_OFFSET', status: 400, message: 'offset must be >= 0' },
        { status: 400 },
      );
    }

    const webhooks = await prisma.webhookEndpoint.findMany({
      where: {
        ownerUserId: user.id,
      },
      skip: offset,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    const total = await prisma.webhookEndpoint.count({
      where: {
        ownerUserId: user.id,
      },
    });

    const data = webhooks.map(w => ({
      id: w.id,
      name: w.name,
      url: w.url,
      enabled: w.enabled,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }));

    return NextResponse.json(
      {
        data,
        pagination: {
          limit,
          offset,
          total,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error('GET /webhooks error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}
