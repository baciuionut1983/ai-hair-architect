import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const httpsRequestMock = vi.hoisted(() => vi.fn());

vi.mock('https', () => ({
  request: httpsRequestMock,
}));

import {
  sendWebhookRequestSafe,
  WebhookSafeHttpError,
  type WebhookTransportRequest,
} from '@/lib/webhook-safe-http-client';

type MockRequest = EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

type MockResponse = EventEmitter & {
  statusCode: number;
  destroy: ReturnType<typeof vi.fn>;
};

function createMockRequest(): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.write = vi.fn();
  req.end = vi.fn();
  req.setTimeout = vi.fn();
  req.destroy = vi.fn((error?: Error) => {
    if (error) {
      queueMicrotask(() => req.emit('error', error));
    }
  });

  return req;
}

function createMockResponse(statusCode: number): MockResponse {
  const res = new EventEmitter() as MockResponse;
  res.statusCode = statusCode;
  res.destroy = vi.fn(() => {
    queueMicrotask(() => {
      const resetError = new Error('socket hang up') as NodeJS.ErrnoException;
      resetError.code = 'ECONNRESET';
      res.emit('error', resetError);
      res.emit('close');
    });
  });

  return res;
}

beforeEach(() => {
  httpsRequestMock.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('webhook-safe-http-client', () => {
  it('hostname resolves to public IP and connection uses that exact IP', async () => {
    let observed: WebhookTransportRequest | undefined;

    const result = await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      body: '{}',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async req => {
        observed = req;
        return { statusCode: 200, responseTimeMs: 15, truncated: false };
      },
    });

    expect(result.statusCode).toBe(200);
    expect(observed?.connectIp).toBe('93.184.216.34');
    expect(observed?.family).toBe(4);
  });

  it('preserves original hostname for SNI', async () => {
    let observed: WebhookTransportRequest | undefined;

    await sendWebhookRequestSafe({
      url: 'https://secure.vendor.example:8443/hook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async req => {
        observed = req;
        return { statusCode: 200, responseTimeMs: 12, truncated: false };
      },
    });

    expect(observed?.servername).toBe('secure.vendor.example');
  });

  it('sets Host header to original hostname with non-standard port', async () => {
    let observed: WebhookTransportRequest | undefined;

    await sendWebhookRequestSafe({
      url: 'https://hooks.example.com:9443/path',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async req => {
        observed = req;
        return { statusCode: 200, responseTimeMs: 10, truncated: false };
      },
    });

    expect(observed?.hostHeader).toBe('hooks.example.com:9443');
  });

  it('formats Host header correctly for IPv6 literal with port', async () => {
    let observed: WebhookTransportRequest | undefined;

    await sendWebhookRequestSafe({
      url: 'https://[2606:4700:4700::1111]:9443/path',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      transport: async req => {
        observed = req;
        return { statusCode: 200, responseTimeMs: 10, truncated: false };
      },
    });

    expect(observed?.hostHeader).toBe('[2606:4700:4700::1111]:9443');
    expect(observed?.servername).toBe('2606:4700:4700::1111');
  });

  it('blocks private IPv4', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['10.0.0.10'],
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_IP' });
  });

  it('blocks private/link-local IPv6', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['fe80::1'],
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_IP' });
  });

  it('blocks request when one of multiple resolved IPs is blocked', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['93.184.216.34', '192.168.1.5'],
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_IP' });
  });

  it('fails when DNS resolution fails', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => {
          throw new Error('resolution failed');
        },
      }),
    ).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });

  it('rejects invalid certificate errors from transport', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['93.184.216.34'],
        transport: async () => {
          throw new WebhookSafeHttpError('TLS_ERROR', 'certificate invalid');
        },
      }),
    ).rejects.toMatchObject({ code: 'TLS_ERROR' });
  });

  it('does not follow redirect responses automatically', async () => {
    const result = await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async () => ({ statusCode: 302, responseTimeMs: 7, truncated: false }),
    });

    expect(result.statusCode).toBe(302);
  });

  it('propagates timeout error', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['93.184.216.34'],
        transport: async () => {
          throw new WebhookSafeHttpError('TIMEOUT', 'timeout');
        },
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('propagates response truncated flag from transport', async () => {
    const result = await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async () => ({ statusCode: 200, responseTimeMs: 11, truncated: true }),
    });

    expect(result.truncated).toBe(true);
  });

  it('rejects invalid URL', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'not-a-url',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('invalid URL does not leave deadline timer active or emit later rejection', async () => {
    vi.useFakeTimers();

    await expect(
      sendWebhookRequestSafe({
        url: 'not-a-url',
        method: 'POST',
        timeoutMs: 20,
        maxResponseBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects http protocol', async () => {
    await expect(
      sendWebhookRequestSafe({
        url: 'http://example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
  });

  it('TOCTOU: resolver is called once and transport uses exactly the validated IP', async () => {
    let resolverCalls = 0;
    let observedIp = '';

    const resolver = vi.fn(async () => {
      resolverCalls += 1;
      if (resolverCalls === 1) {
        return ['93.184.216.34'];
      }
      return ['10.0.0.1'];
    });

    await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      dnsResolver: resolver,
      transport: async req => {
        observedIp = req.connectIp;
        return { statusCode: 200, responseTimeMs: 9, truncated: false };
      },
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(observedIp).toBe('93.184.216.34');
  });

  it('maps ECONNRESET to CONNECTION_ERROR without hanging', async () => {
    httpsRequestMock.mockImplementation((_options, _callback) => {
      const req = createMockRequest();

      req.end.mockImplementation(() => {
        queueMicrotask(() => {
          const resetError = new Error('socket hang up') as NodeJS.ErrnoException;
          resetError.code = 'ECONNRESET';
          req.emit('error', resetError);
        });
      });

      return req;
    });

    await expect(
      sendWebhookRequestSafe({
        url: 'https://api.example.com/webhook',
        method: 'POST',
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        dnsResolver: async () => ['93.184.216.34'],
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_ERROR' });
  });

  it('treats intentional truncation as a successful truncated response', async () => {
    httpsRequestMock.mockImplementation((options, callback) => {
      const req = createMockRequest();
      const res = createMockResponse(200);

      req.end.mockImplementation(() => {
        queueMicrotask(() => {
          callback(res);
          queueMicrotask(() => {
            res.emit('data', Buffer.alloc(32));
            res.emit('data', Buffer.alloc(32));
          });
        });
      });

      return req;
    });

    const result = await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 16,
      dnsResolver: async () => ['93.184.216.34'],
    });

    expect(result.statusCode).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('preserves upstream status when request emits ECONNRESET after intentional truncation', async () => {
    httpsRequestMock.mockImplementation((_options, callback) => {
      const req = createMockRequest();
      const res = new EventEmitter() as MockResponse;
      res.statusCode = 200;
      res.destroy = vi.fn(() => {
        queueMicrotask(() => {
          const resetError = new Error('socket hang up') as NodeJS.ErrnoException;
          resetError.code = 'ECONNRESET';
          req.emit('error', resetError);
        });
      });

      req.end.mockImplementation(() => {
        queueMicrotask(() => {
          callback(res);
          queueMicrotask(() => {
            res.emit('data', Buffer.alloc(32));
          });
        });
      });

      return req;
    });

    const result = await sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 10_000,
      maxResponseBytes: 16,
      dnsResolver: async () => ['93.184.216.34'],
    });

    expect(result.statusCode).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it('times out when DNS resolution exceeds the deadline', async () => {
    vi.useFakeTimers();

    const promise = sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 20,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => new Promise<string[]>(resolve => {
        setTimeout(() => resolve(['93.184.216.34']), 100);
      }),
    });

    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it('times out when a slow response exceeds the total deadline', async () => {
    vi.useFakeTimers();

    httpsRequestMock.mockImplementation((options, callback) => {
      const req = createMockRequest();
      const res = createMockResponse(200);
      let interval: ReturnType<typeof setInterval> | undefined;

      const clearPump = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
      };

      options.signal?.addEventListener('abort', clearPump, { once: true });

      req.destroy.mockImplementation((error?: Error) => {
        clearPump();
        if (error) {
          queueMicrotask(() => req.emit('error', error));
        }
      });

      req.end.mockImplementation(() => {
        queueMicrotask(() => {
          callback(res);
          interval = setInterval(() => {
            res.emit('data', Buffer.alloc(8));
          }, 5);
        });
      });

      return req;
    });

    const promise = sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 20,
      maxResponseBytes: 1024,
      dnsResolver: async () => ['93.184.216.34'],
    });

    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it('clears the deadline timer after success and does not abort later', async () => {
    vi.useFakeTimers();

    let observedSignal: AbortSignal | undefined;

    const resultPromise = sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 20,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async request => {
        observedSignal = request.signal;
        return { statusCode: 200, responseTimeMs: 1, truncated: false };
      },
    });

    await expect(resultPromise).resolves.toMatchObject({ statusCode: 200, truncated: false });

    await vi.advanceTimersByTimeAsync(100);

    expect(observedSignal?.aborted).toBe(false);
  });

  it('settles only once on the success path', async () => {
    vi.useFakeTimers();

    let observedSignal: AbortSignal | undefined;
    let completionCount = 0;

    const resultPromise = sendWebhookRequestSafe({
      url: 'https://api.example.com/webhook',
      method: 'POST',
      timeoutMs: 20,
      maxResponseBytes: 64 * 1024,
      dnsResolver: async () => ['93.184.216.34'],
      transport: async request => {
        observedSignal = request.signal;
        return { statusCode: 200, responseTimeMs: 2, truncated: false };
      },
    }).then(
      result => {
        completionCount += 1;
        return result;
      },
      error => {
        completionCount += 1;
        throw error;
      },
    );

    await expect(resultPromise).resolves.toMatchObject({ statusCode: 200 });

    await vi.advanceTimersByTimeAsync(100);

    expect(completionCount).toBe(1);
    expect(observedSignal?.aborted).toBe(false);
  });

  it('already-aborted signal path rejects deterministically with TIMEOUT', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        handler();
      }

      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    let observedRequest: MockRequest | undefined;

    httpsRequestMock.mockImplementation((_options, _callback) => {
      const req = createMockRequest();
      observedRequest = req;
      return req;
    });

    await expect(
      sendWebhookRequestSafe({
        url: 'https://93.184.216.34/webhook',
        method: 'POST',
        timeoutMs: 25,
        maxResponseBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    expect(observedRequest?.destroy).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});
