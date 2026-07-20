import crypto from 'crypto';
import type { APIRequestContext } from '@playwright/test';
import { setupE2ETestContext, type TestContext } from './e2e-setup';

export function generateE2EToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function getAuthHeaders(token: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
}

type RequestOptions = {
  headers?: Record<string, string>;
  data?: unknown;
  multipart?: Record<string, unknown>;
};

function withAuthHeaders(token: string, options: RequestOptions = {}): RequestOptions {
  return {
    ...options,
    headers: getAuthHeaders(token, options.headers),
  };
}

export function createAuthedApi(request: APIRequestContext, token: string) {
  return {
    get: (url: string, options?: RequestOptions) => request.get(url, withAuthHeaders(token, options)),
    post: (url: string, options?: RequestOptions) => request.post(url, withAuthHeaders(token, options)),
    patch: (url: string, options?: RequestOptions) => request.patch(url, withAuthHeaders(token, options)),
    delete: (url: string, options?: RequestOptions) => request.delete(url, withAuthHeaders(token, options)),
  };
}

export async function setupAuthenticatedE2EContext(
  request: APIRequestContext,
  role: 'professional' | 'salon',
): Promise<{ context: TestContext; api: ReturnType<typeof createAuthedApi> }> {
  const context = await setupE2ETestContext(role);
  return {
    context,
    api: createAuthedApi(request, context.token),
  };
}
