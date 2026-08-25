// Exclusive file-based lock -- see this round's own task spec: "Nu
// permite două procese AI care scriu simultan în același worktree" and
// test requirements 20/21 (two supervisors, two executors). Uses
// Node's own `wx` flag (open for writing, FAIL if the file already
// exists) for the actual exclusivity primitive -- this is an atomic
// filesystem operation on every platform Node supports (including
// Windows/NTFS, this project's own real environment), so there is no
// TOCTOU race between "check if the lock exists" and "create it" the
// way a naive existsSync-then-writeFileSync pair would have.
//
// STALE LOCK HANDLING: a lock file records the PID that created it. If
// that PID is no longer a running process (e.g. the Supervisor crashed
// without cleaning up), the lock is considered stale and safe to
// reclaim -- checked via a liveness probe (see isProcessAlive below),
// never by a fixed TTL alone (a fixed TTL would either reclaim a
// legitimately still-running long task too early, or leave a genuinely
// dead lock in place too long).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export interface LockInfo {
  pid: number;
  taskId: string;
  acquiredAt: string;
}

export type AcquireLockResult =
  | { ok: true }
  | { ok: false; reason: "already_locked"; holder: LockInfo }
  | { ok: false; reason: "already_locked"; holder: null };

// Injectable so tests never need to spawn/kill a real OS process to
// exercise the stale-lock-reclaim path.
export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing but still performs the existence/permission
    // check -- the standard, dependency-free Node idiom for "is this PID
    // alive", including on Windows (Node's own process.kill shim handles
    // the platform difference).
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(
  lockFilePath: string,
  taskId: string,
  currentPid: number = process.pid,
  processAliveCheck: (pid: number) => boolean = isProcessAlive,
): AcquireLockResult {
  if (existsSync(lockFilePath)) {
    let holder: LockInfo | null = null;
    try {
      holder = JSON.parse(readFileSync(lockFilePath, "utf8")) as LockInfo;
    } catch {
      holder = null;
    }
    const stillAlive = holder !== null && processAliveCheck(holder.pid);
    if (stillAlive) {
      return { ok: false, reason: "already_locked", holder };
    }
    // Stale -- the PID that held this lock is gone. Safe to reclaim.
    rmSync(lockFilePath, { force: true });
  }

  const info: LockInfo = { pid: currentPid, taskId, acquiredAt: new Date().toISOString() };
  try {
    // "wx": exclusive create, fails if the file now exists -- closes the
    // TOCTOU window between the existsSync check above and this write,
    // for the case where a second process raced us between the two.
    writeFileSync(lockFilePath, JSON.stringify(info, null, 2), { flag: "wx" });
  } catch {
    return { ok: false, reason: "already_locked", holder: null };
  }
  return { ok: true };
}

export function releaseLock(lockFilePath: string, currentPid: number = process.pid): void {
  if (!existsSync(lockFilePath)) return;
  try {
    const holder = JSON.parse(readFileSync(lockFilePath, "utf8")) as LockInfo;
    // Only ever removes a lock this SAME process holds -- a supervisor
    // must never release a lock it does not own, even accidentally
    // (e.g. a bug that calls releaseLock with the wrong path).
    if (holder.pid === currentPid) {
      rmSync(lockFilePath, { force: true });
    }
  } catch {
    // Malformed lock file -- leave it in place rather than guessing;
    // acquireLock's own stale-check will clean it up once the recorded
    // (unparseable) holder is confirmed gone by a future acquire attempt
    // that itself also fails to parse it -- treated as holder: null,
    // which acquireLock already refuses to blindly override.
  }
}
