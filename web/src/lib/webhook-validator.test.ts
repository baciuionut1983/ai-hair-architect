import { describe, it, expect } from 'vitest';
import { validateWebhookUrl, isIpv4Forbidden, isIpv6Forbidden } from '@/lib/webhook-validator';

describe('Webhook Validator', () => {
  describe('validateWebhookUrl', () => {
    it('accepts valid HTTPS URL', () => {
      const result = validateWebhookUrl('https://example.com/webhook', false);
      expect(result.valid).toBe(true);
    });

    it('rejects HTTP in production', () => {
      const result = validateWebhookUrl('http://example.com/webhook', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_NOT_HTTPS');
    });

    it('accepts HTTP localhost in development', () => {
      const result = validateWebhookUrl('http://localhost:8080/webhook', true);
      expect(result.valid).toBe(true);
    });

    it('accepts HTTP 127.0.0.1 in development', () => {
      const result = validateWebhookUrl('http://127.0.0.1:3000/webhook', true);
      expect(result.valid).toBe(true);
    });

    it('rejects non-HTTP schemes', () => {
      const result = validateWebhookUrl('data:text/html,<script>alert(1)</script>', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_INVALID_SCHEME');
    });

    it('rejects URL > 2048 chars', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2100);
      const result = validateWebhookUrl(longUrl, false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_TOO_LONG');
    });

    it('rejects URL with credentials', () => {
      const result = validateWebhookUrl('https://user:pass@example.com/webhook', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_WITH_CREDENTIALS');
    });

    it('rejects empty hostname', () => {
      const result = validateWebhookUrl('https://:8080/webhook', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_EMPTY_HOSTNAME');
    });

    it('rejects invalid port', () => {
      const result = validateWebhookUrl('https://example.com:99999/webhook', false);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL_INVALID_PORT');
    });
  });

  describe('isIpv4Forbidden', () => {
    it('rejects loopback 127.0.0.1', () => {
      expect(isIpv4Forbidden('127.0.0.1')).toBe(true);
    });

    it('rejects private 10.0.0.0/8', () => {
      expect(isIpv4Forbidden('10.0.0.1')).toBe(true);
      expect(isIpv4Forbidden('10.255.255.255')).toBe(true);
    });

    it('rejects private 172.16.0.0/12', () => {
      expect(isIpv4Forbidden('172.16.0.1')).toBe(true);
      expect(isIpv4Forbidden('172.31.255.255')).toBe(true);
    });

    it('rejects private 192.168.0.0/16', () => {
      expect(isIpv4Forbidden('192.168.0.1')).toBe(true);
      expect(isIpv4Forbidden('192.168.255.255')).toBe(true);
    });

    it('rejects link-local 169.254.0.0/16', () => {
      expect(isIpv4Forbidden('169.254.0.1')).toBe(true);
    });

    it('rejects multicast 224.0.0.0/4', () => {
      expect(isIpv4Forbidden('224.0.0.1')).toBe(true);
      expect(isIpv4Forbidden('239.255.255.255')).toBe(true);
    });

    it('rejects CGN 100.64.0.0/10', () => {
      expect(isIpv4Forbidden('100.64.0.1')).toBe(true);
      expect(isIpv4Forbidden('100.127.255.255')).toBe(true);
    });

    it('accepts public IPs', () => {
      expect(isIpv4Forbidden('8.8.8.8')).toBe(false);
      expect(isIpv4Forbidden('1.1.1.1')).toBe(false);
    });
  });

  describe('isIpv6Forbidden', () => {
    it('rejects loopback ::1', () => {
      expect(isIpv6Forbidden('::1')).toBe(true);
    });

    it('rejects unspecified ::', () => {
      expect(isIpv6Forbidden('::')).toBe(true);
    });

    it('rejects unique local fc00::/7', () => {
      expect(isIpv6Forbidden('fc00::1')).toBe(true);
    });

    it('rejects link-local fe80::/10', () => {
      expect(isIpv6Forbidden('fe80::1')).toBe(true);
    });

    it('rejects multicast ff00::/8', () => {
      expect(isIpv6Forbidden('ff00::1')).toBe(true);
      expect(isIpv6Forbidden('ffff::1')).toBe(true);
    });

    it('accepts public IPv6', () => {
      expect(isIpv6Forbidden('2001:4860:4860::8888')).toBe(false);
    });
  });
});
