import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, releaseLock } from "./lock.js";

describe("acquireLock / releaseLock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "claude-supervisor-lock-test-"));
    lockPath = join(dir, "repo.lock");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires a lock when none exists", () => {
    const result = acquireLock(lockPath, "task-1", 1234, () => true);
    expect(result.ok).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  // Required test 20: two supervisors cannot control the same repo
  // simultaneously.
  it("refuses a second acquire while the first holder's process is still alive -- two supervisors, same repo", () => {
    const first = acquireLock(lockPath, "task-1", 1234, () => true);
    expect(first.ok).toBe(true);

    const second = acquireLock(lockPath, "task-2", 5678, () => true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already_locked");
      expect(second.holder?.pid).toBe(1234);
    }
  });

  // Required test 21: two executors cannot be launched for the same
  // worktree -- modeled identically (a lock is a lock, regardless of
  // which layer of the system is the thing being protected).
  it("refuses a second acquire for a different taskId in the same worktree while the first is alive", () => {
    acquireLock(lockPath, "task-executor-A", 1111, () => true);
    const second = acquireLock(lockPath, "task-executor-B", 2222, () => true);
    expect(second.ok).toBe(false);
  });

  it("reclaims a STALE lock -- the recorded holder PID is no longer alive", () => {
    const first = acquireLock(lockPath, "task-1", 1234, () => true);
    expect(first.ok).toBe(true);

    // Second attempt, simulating that PID 1234 has since died.
    const second = acquireLock(lockPath, "task-2", 5678, () => false);
    expect(second.ok).toBe(true);
  });

  it("releaseLock removes a lock this same PID holds", () => {
    acquireLock(lockPath, "task-1", 1234, () => true);
    releaseLock(lockPath, 1234);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releaseLock never removes a lock a DIFFERENT PID holds -- never releases someone else's lock", () => {
    acquireLock(lockPath, "task-1", 1234, () => true);
    releaseLock(lockPath, 9999);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("releaseLock on a non-existent lock file is a safe no-op", () => {
    expect(() => releaseLock(lockPath, 1234)).not.toThrow();
  });

  it("allows re-acquiring after a clean release", () => {
    acquireLock(lockPath, "task-1", 1234, () => true);
    releaseLock(lockPath, 1234);
    const reacquired = acquireLock(lockPath, "task-2", 5678, () => true);
    expect(reacquired.ok).toBe(true);
  });

  it("treats a malformed lock file as reclaimable rather than throwing", () => {
    writeFileSync(lockPath, "not valid json", "utf8");
    const result = acquireLock(lockPath, "task-1", 1234, () => true);
    expect(result.ok).toBe(true);
  });
});
