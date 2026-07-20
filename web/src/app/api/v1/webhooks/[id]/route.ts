import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from '@/middleware/analytics-auth';
import { validateWebhookUrl, resolveDnsAndValidate } from '@/lib/webhook-validator';

async function getWebhookOrNotFound(id: string, userId: string, enabledOnly: boolean = true) {
  const webhook = await prisma.webhookEndpoint.findUnique({
    where: { id },
  });

  if (!webhook || webhook.ownerUserId !== userId) {
    return null;
  }

  if (enabledOnly && !webhook.enabled) {
    return null;
  }

  return webhook;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const webhook = await getWebhookOrNotFound(id, user.id, false);

    if (!webhook) {
      return NextResponse.json(
        { error: 'NOT_FOUND', status: 404, message: 'Webhook not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        enabled: webhook.enabled,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error('GET /webhooks/{id} error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const webhook = await getWebhookOrNotFound(id, user.id, false);

    if (!webhook) {
      return NextResponse.json(
        { error: 'NOT_FOUND', status: 404, message: 'Webhook not found' },
        { status: 404 },
      );
    }

    const body = await req.json();
    const { name, url, enabled } = body;

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.length === 0) {
        return NextResponse.json(
          { error: 'INVALID_INPUT', status: 400, message: 'name must be a non-empty string' },
          { status: 400 },
        );
      }

      if (name.length > 255) {
        return NextResponse.json(
          { error: 'NAME_TOO_LONG', status: 400, message: 'name must be 255 characters or less' },
          { status: 400 },
        );
      }

      updates.name = name;
    }

    if (url !== undefined) {
      if (typeof url !== 'string') {
        return NextResponse.json(
          { error: 'INVALID_INPUT', status: 400, message: 'url must be a string' },
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

      updates.url = url;
    }

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'INVALID_INPUT', status: 422, message: 'enabled must be a boolean' },
          { status: 422 },
        );
      }

      updates.enabled = enabled;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        {
          id: webhook.id,
          name: webhook.name,
          url: webhook.url,
          enabled: webhook.enabled,
          createdAt: webhook.createdAt.toISOString(),
          updatedAt: webhook.updatedAt.toISOString(),
        },
        { status: 200 },
      );
    }

    const updated = await prisma.webhookEndpoint.update({
      where: { id: webhook.id },
      data: updates,
    });

    return NextResponse.json(
      {
        id: updated.id,
        name: updated.name,
        url: updated.url,
        enabled: updated.enabled,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      { status: 200 },
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
    console.error('PATCH /webhooks/{id} error:', message);

    if (message.includes('Unique constraint failed')) {
      return NextResponse.json(
        { error: 'DUPLICATE_NAME', status: 409, message: 'Webhook name already exists' },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const webhook = await prisma.webhookEndpoint.findUnique({
      where: { id },
    });

    if (!webhook || webhook.ownerUserId !== user.id) {
      return NextResponse.json(
        { error: 'NOT_FOUND', status: 404, message: 'Webhook not found' },
        { status: 404 },
      );
    }

    await prisma.webhookEndpoint.update({
      where: { id: webhook.id },
      data: { enabled: false },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error('DELETE /webhooks/{id} error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}
