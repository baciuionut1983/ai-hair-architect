import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateAnalyticsAccess, createAuthErrorResponse, AnalyticsAuthError } from '@/middleware/analytics-auth';
import { decryptSecret, hmacSignPayload, getMasterKeyFromEnv } from '@/lib/webhook-crypto';
import { sendWebhookRequestSafe, WebhookSafeHttpError } from '@/lib/webhook-safe-http-client';

const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KB
const TIMEOUT_MS = 10 * 1000; // 10 seconds

async function getWebhookOrNotFound(id: string, userId: string) {
  const webhook = await prisma.webhookEndpoint.findUnique({
    where: { id },
  });

  if (!webhook || webhook.ownerUserId !== userId) {
    return null;
  }

  return webhook;
}

function generateTestId(): string {
  return `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await validateAnalyticsAccess(req);
    const { id } = await params;

    const webhook = await getWebhookOrNotFound(id, user.id);

    if (!webhook) {
      return NextResponse.json(
        { error: 'NOT_FOUND', status: 404, message: 'Webhook not found' },
        { status: 404 },
      );
    }

    if (!webhook.enabled) {
      return NextResponse.json(
        { error: 'WEBHOOK_DISABLED', status: 409, message: 'Webhook is disabled and cannot be tested' },
        { status: 409 },
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

    let plainSecret;
    try {
      plainSecret = decryptSecret(webhook.secretEncrypted, webhook.ownerUserId, masterKey);
    } catch {
      console.error('Decryption error');
      return NextResponse.json(
        { error: 'DECRYPTION_ERROR', status: 500, message: 'Failed to decrypt webhook configuration' },
        { status: 500 },
      );
    }

    const testId = generateTestId();
    const timestamp = new Date().toISOString();

    const payload = {
      event: 'webhook_test',
      message: 'This is a test delivery from Audit Logging system.',
      timestamp,
      webhookId: webhook.id,
    };

    const payloadJson = JSON.stringify(payload);
    const signature = hmacSignPayload(payloadJson, timestamp, plainSecret);

    const startTime = Date.now();
    let responseTime = 0;

    try {
      const delivery = await sendWebhookRequestSafe({
        url: webhook.url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Event': 'webhook_test',
          'User-Agent': 'AuditLogging/1.0',
        },
        body: payloadJson,
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      });

      responseTime = delivery.responseTimeMs;

      if (delivery.statusCode >= 200 && delivery.statusCode < 300) {
        return NextResponse.json(
          {
            status: 'delivered',
            webhookId: webhook.id,
            testId,
            httpStatus: delivery.statusCode,
            responseTime,
            truncated: delivery.truncated,
            message: delivery.truncated ? 'Response was truncated (exceeded 64 KB limit)' : 'Test delivery succeeded',
          },
          { status: 200 },
        );
      }

      if (delivery.statusCode >= 300 && delivery.statusCode < 400) {
        return NextResponse.json(
          {
            status: 'failed',
            webhookId: webhook.id,
            testId,
            httpStatus: delivery.statusCode,
            error: 'WEBHOOK_REDIRECT_REJECTED',
            responseTime,
            message: `Redirect not allowed (HTTP ${delivery.statusCode})`,
          },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          status: 'failed',
          webhookId: webhook.id,
          testId,
          httpStatus: delivery.statusCode,
          error: 'WEBHOOK_UPSTREAM_ERROR',
          responseTime,
          truncated: delivery.truncated,
          message: `Webhook endpoint returned HTTP ${delivery.statusCode}`,
        },
        { status: 200 },
      );
    } catch (deliveryError) {
      responseTime = Date.now() - startTime;

      if (deliveryError instanceof WebhookSafeHttpError) {
        if (deliveryError.code === 'TIMEOUT') {
          return NextResponse.json(
            {
              status: 'timeout',
              webhookId: webhook.id,
              testId,
              httpStatus: null,
              error: 'WEBHOOK_TIMEOUT',
              responseTime: TIMEOUT_MS,
              message: 'Test delivery timed out after 10 seconds',
            },
            { status: 200 },
          );
        }

        if (deliveryError.code === 'BLOCKED_IP' || deliveryError.code === 'DNS_FAILED') {
          return NextResponse.json(
            {
              status: 'failed',
              webhookId: webhook.id,
              testId,
              httpStatus: null,
              error: 'WEBHOOK_SECURITY_ERROR',
              responseTime,
              message: 'Webhook endpoint failed security validation',
            },
            { status: 200 },
          );
        }

        if (deliveryError.code === 'CONNECTION_ERROR') {
          return NextResponse.json(
            {
              status: 'failed',
              webhookId: webhook.id,
              testId,
              httpStatus: null,
              error: 'WEBHOOK_CONNECTION_ERROR',
              responseTime,
              message: 'Could not connect to endpoint',
            },
            { status: 200 },
          );
        }

        if (deliveryError.code === 'TLS_ERROR') {
          return NextResponse.json(
            {
              status: 'failed',
              webhookId: webhook.id,
              testId,
              httpStatus: null,
              error: 'WEBHOOK_TLS_ERROR',
              responseTime,
              message: 'Secure connection validation failed',
            },
            { status: 200 },
          );
        }
      }

      console.error('Test delivery error:', deliveryError);

      return NextResponse.json(
        {
          status: 'failed',
          webhookId: webhook.id,
          testId,
          httpStatus: null,
          error: 'WEBHOOK_DELIVERY_ERROR',
          responseTime,
          message: 'Test delivery failed',
        },
        { status: 200 },
      );
    }
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error('POST /webhooks/{id}/test error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', status: 500, message: 'An error occurred' }, { status: 500 });
  }
}
