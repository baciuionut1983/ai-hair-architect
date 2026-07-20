import * as https from 'https';
import { resolve4, resolve6 } from 'dns/promises';
import * as net from 'net';
import { isIpv4Forbidden, isIpv6Forbidden } from '@/lib/webhook-validator';

export type WebhookSafeHttpErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'DNS_FAILED'
  | 'BLOCKED_IP'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'CONNECTION_ERROR'
  | 'REQUEST_FAILED';

export class WebhookSafeHttpError extends Error {
  code: WebhookSafeHttpErrorCode;

  constructor(code: WebhookSafeHttpErrorCode, message: string) {
    super(message);
    this.name = 'WebhookSafeHttpError';
    this.code = code;
  }
}

export interface WebhookSafeHttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  dnsResolver?: (hostname: string) => Promise<string[]>;
  transport?: (request: WebhookTransportRequest) => Promise<WebhookSafeHttpResponse>;
}

export interface WebhookTransportRequest {
  connectIp: string;
  family: 4 | 6;
  servername: string;
  hostHeader: string;
  method: string;
  port: number;
  path: string;
  protocol: 'https:';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}

export interface WebhookSafeHttpResponse {
  statusCode: number;
  responseTimeMs: number;
  truncated: boolean;
}

async function defaultDnsResolver(hostname: string): Promise<string[]> {
  const ips: string[] = [];

  try {
    ips.push(...(await resolve4(hostname)));
  } catch {
    // Continue to IPv6 resolution.
  }

  try {
    ips.push(...(await resolve6(hostname)));
  } catch {
    // Continue with whatever addresses were resolved.
  }

  return ips;
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    return isIpv4Forbidden(ip);
  }
  if (family === 6) {
    return isIpv6Forbidden(ip);
  }
  return true;
}

function defaultPort(protocol: string): number {
  if (protocol === 'https:') {
    return 443;
  }
  return 0;
}

function formatHostHeader(hostname: string, port: number, protocol: string): string {
  const normalizedHost = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;

  const protocolPort = defaultPort(protocol);
  if (port === protocolPort) {
    return normalizedHost;
  }

  return `${normalizedHost}:${port}`;
}

function normalizeRequestError(error: unknown): WebhookSafeHttpError {
  if (error instanceof WebhookSafeHttpError) {
    return error;
  }

  const err = error as NodeJS.ErrnoException;
  const code = err?.code || '';

  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  ) {
    return new WebhookSafeHttpError('TLS_ERROR', 'TLS certificate validation failed');
  }

  if (code === 'ETIMEDOUT' || code === 'ERR_HTTP_REQUEST_TIMEOUT') {
    return new WebhookSafeHttpError('TIMEOUT', 'Request timed out');
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    return new WebhookSafeHttpError('CONNECTION_ERROR', 'Connection failed');
  }

  return new WebhookSafeHttpError('REQUEST_FAILED', 'Webhook request failed');
}

async function defaultTransport(request: WebhookTransportRequest): Promise<WebhookSafeHttpResponse> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let truncatedByDesign = false;
    let currentStatusCode = 0;
    let cleanupSignalListener = () => {};

    const resolveOnce = (value: WebhookSafeHttpResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupSignalListener();
      resolve(value);
    };

    const rejectOnce = (error: WebhookSafeHttpError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupSignalListener();
      reject(error);
    };

    const rejectConnectionError = (error: unknown) => {
      if (truncatedByDesign) {
        resolveOnce({
          statusCode: currentStatusCode,
          responseTimeMs: Date.now() - startedAt,
          truncated: true,
        });
        return;
      }

      rejectOnce(normalizeRequestError(error));
    };

    const req = https.request(
      {
        protocol: request.protocol,
        hostname: request.connectIp,
        family: request.family,
        port: request.port,
        method: request.method,
        path: request.path,
        headers: {
          ...request.headers,
          Host: request.hostHeader,
        },
        servername: request.servername,
        rejectUnauthorized: true,
      },
      res => {
        const statusCode = res.statusCode || 0;
        currentStatusCode = statusCode;
        let bodySize = 0;

        res.on('data', (chunk: Buffer) => {
          bodySize += chunk.length;
          if (bodySize > request.maxResponseBytes && !truncatedByDesign) {
            truncatedByDesign = true;
            res.destroy();
          }
        });

        res.on('end', () => {
          resolveOnce({
            statusCode,
            responseTimeMs: Date.now() - startedAt,
            truncated: truncatedByDesign,
          });
        });

        res.on('close', () => {
          if (truncatedByDesign) {
            resolveOnce({
              statusCode,
              responseTimeMs: Date.now() - startedAt,
              truncated: true,
            });
          }
        });

        res.on('error', error => {
          if (truncatedByDesign) {
            resolveOnce({
              statusCode: currentStatusCode,
              responseTimeMs: Date.now() - startedAt,
              truncated: true,
            });
            return;
          }

          rejectConnectionError(error);
        });
      },
    );

    req.on('error', error => {
      if (error instanceof WebhookSafeHttpError && error.code === 'TIMEOUT') {
        rejectOnce(error);
        return;
      }

      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ECONNRESET') {
        if (truncatedByDesign) {
          resolveOnce({
            statusCode: currentStatusCode,
            responseTimeMs: Date.now() - startedAt,
            truncated: true,
          });
          return;
        }

        rejectOnce(new WebhookSafeHttpError('CONNECTION_ERROR', 'Connection failed'));
        return;
      }

      rejectOnce(normalizeRequestError(error));
    });

    if (request.signal) {
      const onAbort = () => {
        req.destroy(new WebhookSafeHttpError('TIMEOUT', 'Request timed out'));
      };

      cleanupSignalListener = () => {
        request.signal?.removeEventListener('abort', onAbort);
      };

      if (request.signal.aborted) {
        onAbort();
      } else {
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    req.setTimeout(request.timeoutMs, () => {
      req.destroy(new WebhookSafeHttpError('TIMEOUT', 'Request timed out'));
    });

    if (request.body) {
      req.write(request.body);
    }

    req.end();
  });
}

export async function sendWebhookRequestSafe(
  request: WebhookSafeHttpRequest,
): Promise<WebhookSafeHttpResponse> {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    throw new WebhookSafeHttpError('INVALID_URL', 'Invalid webhook URL');
  }

  const deadlineController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const deadlinePromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      deadlineController.abort();
      reject(new WebhookSafeHttpError('TIMEOUT', 'Request timed out'));
    }, request.timeoutMs);
  });

  try {
    if (parsed.protocol !== 'https:') {
      throw new WebhookSafeHttpError('UNSUPPORTED_PROTOCOL', 'Only HTTPS webhook URLs are allowed');
    }

    const rawHostname = parsed.hostname;
    const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;

    if (!hostname) {
      throw new WebhookSafeHttpError('INVALID_URL', 'Invalid webhook URL');
    }

    const resolver = request.dnsResolver || defaultDnsResolver;
    const hostnameIsIp = net.isIP(hostname) !== 0;

    let resolvedIps: string[];
    if (hostnameIsIp) {
      resolvedIps = [hostname];
    } else {
      try {
        resolvedIps = await Promise.race([
          resolver(hostname),
          deadlinePromise,
        ]) as string[];
      } catch (error) {
        if (error instanceof WebhookSafeHttpError && error.code === 'TIMEOUT') {
          throw error;
        }

        throw new WebhookSafeHttpError('DNS_FAILED', 'Failed to resolve webhook hostname');
      }
    }

    if (!resolvedIps.length) {
      throw new WebhookSafeHttpError('DNS_FAILED', 'Failed to resolve webhook hostname');
    }

    if (resolvedIps.some(ip => isBlockedIp(ip))) {
      throw new WebhookSafeHttpError('BLOCKED_IP', 'Webhook hostname resolves to blocked IP space');
    }

    const connectIp = resolvedIps[0];
    const family = net.isIP(connectIp);
    if (family !== 4 && family !== 6) {
      throw new WebhookSafeHttpError('DNS_FAILED', 'Resolved address is invalid');
    }

    const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort(parsed.protocol);
    const path = `${parsed.pathname}${parsed.search}`;
    const hostHeader = formatHostHeader(hostname, port, parsed.protocol);

    const headers = {
      ...(request.headers || {}),
    };

    const transport = request.transport || defaultTransport;

    return await Promise.race([
      transport({
        connectIp,
        family,
        servername: hostname,
        hostHeader,
        method: request.method,
        port,
        path,
        protocol: 'https:',
        headers,
        body: request.body,
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes,
        signal: deadlineController.signal,
      }),
      deadlinePromise,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
