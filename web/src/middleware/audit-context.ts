import { NextRequest } from 'next/server';

export interface AuditContext {
  ipAddress: string;
  userAgent: string | null;
}

export function extractAuditContext(request: NextRequest): AuditContext {
  const ipAddress = extractIpAddress(request);
  const userAgent = request.headers.get('user-agent');

  return {
    ipAddress,
    userAgent,
  };
}

function extractIpAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}
