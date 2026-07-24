import { URL } from 'url';
import { resolve4, resolve6 } from 'dns/promises';

const FORBIDDEN_IPV4_RANGES = [
  { name: 'loopback', range: '127.0.0.0/8' },
  { name: 'private-10', range: '10.0.0.0/8' },
  { name: 'private-172', range: '172.16.0.0/12' },
  { name: 'private-192', range: '192.168.0.0/16' },
  { name: 'link-local', range: '169.254.0.0/16' },
  { name: 'this-network', range: '0.0.0.0/8' },
  { name: 'broadcast', range: '255.255.255.255/32' },
  { name: 'multicast', range: '224.0.0.0/4' },
  { name: 'reserved', range: '240.0.0.0/4' },
  { name: 'cgn', range: '100.64.0.0/10' },
  { name: 'doc-192', range: '192.0.2.0/24' },
  { name: 'doc-198', range: '198.51.100.0/24' },
  { name: 'doc-203', range: '203.0.113.0/24' },
];

const FORBIDDEN_IPV6_RANGES = [
  { name: 'loopback', range: '::1/128' },
  { name: 'unspecified', range: '::/128' },
  { name: 'unique-local', range: 'fc00::/7' },
  { name: 'link-local', range: 'fe80::/10' },
  { name: 'multicast', range: 'ff00::/8' },
  { name: 'site-local', range: 'fec0::/10' },
  { name: 'documentation', range: '2001:db8::/32' },
];

function ipToInt(ip: string): bigint {
  const parts = ip.split('.').map(p => BigInt(parseInt(p, 10)));
  return (parts[0] << BigInt(24)) | (parts[1] << BigInt(16)) | (parts[2] << BigInt(8)) | parts[3];
}

function isIpInRange(ip: string, rangeStart: string, rangeEnd: string): boolean {
  const ipNum = ipToInt(ip);
  const start = ipToInt(rangeStart);
  const end = ipToInt(rangeEnd);
  return ipNum >= start && ipNum <= end;
}

function ipv4ToCidr(ip: string, prefix: number): { start: string; end: string } {
  const ipNum = ipToInt(ip);
  const mask = ~((BigInt(1) << BigInt(32 - prefix)) - BigInt(1)) & BigInt(0xffffffff);
  const invMask = ~mask & BigInt(0xffffffff);

  const start = ipNum & mask;
  const end = ipNum | invMask;

  const toIpString = (num: bigint) => {
    const a = (num >> BigInt(24)) & BigInt(0xff);
    const b = (num >> BigInt(16)) & BigInt(0xff);
    const c = (num >> BigInt(8)) & BigInt(0xff);
    const d = num & BigInt(0xff);
    return `${a}.${b}.${c}.${d}`;
  };

  return {
    start: toIpString(start),
    end: toIpString(end),
  };
}

export function isIpv4Forbidden(ip: string): boolean {
  for (const range of FORBIDDEN_IPV4_RANGES) {
    const [rangeIp, prefixStr] = range.range.split('/');
    const prefix = parseInt(prefixStr, 10);
    const { start, end } = ipv4ToCidr(rangeIp, prefix);

    if (isIpInRange(ip, start, end)) {
      return true;
    }
  }
  return false;
}

function isIpv6InRange(ip: string, rangeStart: string, prefixLen: number): boolean {
  const ipParts = ip.split(':').filter(p => p !== '');
  const rangeParts = rangeStart.split(':').filter(p => p !== '');

  for (let i = 0; i < Math.ceil(prefixLen / 16); i++) {
    const ipPart = parseInt(ipParts[i] || '0', 16);
    const rangePart = parseInt(rangeParts[i] || '0', 16);

    const bitsToCheck = Math.min(16, prefixLen - i * 16);
    const mask = (0xffff << (16 - bitsToCheck)) & 0xffff;

    if ((ipPart & mask) !== (rangePart & mask)) {
      return false;
    }
  }

  return true;
}

export function isIpv6Forbidden(ip: string): boolean {
  if (ip === '::1') return true;
  if (ip === '::') return true;

  for (const range of FORBIDDEN_IPV6_RANGES) {
    const [rangeIp, prefixStr] = range.range.split('/');
    const prefix = parseInt(prefixStr, 10);

    if (isIpv6InRange(ip, rangeIp, prefix)) {
      return true;
    }
  }

  if (ip.includes('::ffff:')) {
    const ipv4Part = ip.replace('::ffff:', '');
    if (isIpv4Forbidden(ipv4Part)) {
      return true;
    }
  }

  return false;
}

export function validateWebhookUrl(
  urlString: string,
  isDevelopment: boolean,
): { valid: boolean; error?: string } {
  if (!urlString) {
    return { valid: false, error: 'URL_REQUIRED' };
  }

  if (urlString.length > 2048) {
    return { valid: false, error: 'URL_TOO_LONG' };
  }

  const schemeMatch = urlString.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/)?/);
  if (!schemeMatch) {
    return { valid: false, error: 'URL_INVALID_FORMAT' };
  }

  const scheme = schemeMatch[1];
  if (!['http', 'https'].includes(scheme)) {
    return { valid: false, error: 'URL_INVALID_SCHEME' };
  }

  const urlRegex = /^(https?):\/\/([^/:?#]*)(?::(\d+))?/;
  const match = urlString.match(urlRegex);

  if (!match) {
    return { valid: false, error: 'URL_INVALID_FORMAT' };
  }

  const hostname = match[2];

  if (!hostname) {
    return { valid: false, error: 'URL_EMPTY_HOSTNAME' };
  }

  const portStr = match[3];
  if (portStr) {
    const port = parseInt(portStr, 10);
    if (port < 1 || port > 65535) {
      return { valid: false, error: 'URL_INVALID_PORT' };
    }
  }

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'URL_INVALID_FORMAT' };
  }

  if (scheme === 'http' && !isDevelopment) {
    return { valid: false, error: 'URL_NOT_HTTPS' };
  }

  if (scheme === 'http' && isDevelopment) {
    const hostnameLC = url.hostname.toLowerCase();
    const isLocalhost = hostnameLC === 'localhost';
    const isLoopback = hostnameLC === '127.0.0.1' || hostnameLC === '::1';

    if (!isLocalhost && !isLoopback) {
      return { valid: false, error: 'URL_NOT_HTTPS' };
    }
  }

  if (url.username || url.password) {
    return { valid: false, error: 'URL_WITH_CREDENTIALS' };
  }

  return { valid: true };
}

export async function resolveDnsAndValidate(hostname: string, isDevelopment: boolean = false): Promise<{
  valid: boolean;
  ips?: string[];
  error?: string;
}> {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([\da-f]{0,4}:){2,7}[\da-f]{0,4}$/i;

  if (isDevelopment) {
    const hostnameLC = hostname.toLowerCase();
    if (hostnameLC === 'localhost') {
      return { valid: true, ips: ['127.0.0.1', '::1'] };
    }
  }

  if (ipv4Regex.test(hostname)) {
    if (!isDevelopment && isIpv4Forbidden(hostname)) {
      return { valid: false, error: 'URL_PRIVATE_IP' };
    }
    return { valid: true, ips: [hostname] };
  }

  if (ipv6Regex.test(hostname)) {
    if (!isDevelopment && isIpv6Forbidden(hostname)) {
      return { valid: false, error: 'URL_PRIVATE_IP' };
    }
    return { valid: true, ips: [hostname] };
  }

  const ips: string[] = [];

  try {
    const ipv4s = await resolve4(hostname);
    ips.push(...ipv4s);
  } catch {
    // IPv4 resolution failed, continue to IPv6
  }

  try {
    const ipv6s = await resolve6(hostname);
    ips.push(...ipv6s);
  } catch {
    // IPv6 resolution failed
  }

  if (ips.length === 0) {
    return { valid: false, error: 'URL_DNS_FAILED' };
  }

  for (const ip of ips) {
    if (!isDevelopment && isIpv4Forbidden(ip)) {
      return { valid: false, error: 'URL_PRIVATE_IP' };
    }
    if (!isDevelopment && isIpv6Forbidden(ip)) {
      return { valid: false, error: 'URL_PRIVATE_IP' };
    }
  }

  return { valid: true, ips };
}
