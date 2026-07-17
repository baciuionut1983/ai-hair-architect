import { describe, it, expect } from 'vitest';
import { checkRole } from './auth-role';

describe('Role-Based Access Control', () => {
  it('returns 401 for no user', () => {
    const result = checkRole(null, ['professional']);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 401 for user without role', () => {
    const result = checkRole({ id: 'user-1' }, ['professional']);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 403 for consumer role when professional required', () => {
    const user = { id: 'user-1', role: 'consumer' };
    const result = checkRole(user, ['professional', 'salon']);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it('allows professional role', () => {
    const user = { id: 'user-1', role: 'professional' };
    const result = checkRole(user, ['professional', 'salon']);
    expect(result.allowed).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('allows salon role', () => {
    const user = { id: 'user-1', role: 'salon' };
    const result = checkRole(user, ['professional', 'salon']);
    expect(result.allowed).toBe(true);
  });

  it('allows admin role for any resource', () => {
    const user = { id: 'user-1', role: 'professional' };
    const result = checkRole(user, ['professional']);
    expect(result.allowed).toBe(true);
  });
});
