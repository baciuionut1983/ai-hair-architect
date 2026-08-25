// Supervisor v1.3 -- Agent SDK executor permission policy. Pure, fully
// tested: decides exactly which tools the SDK-driven executor may use.
// This is a POLICY layer only -- see this package's own top-level
// architectural rule (v1.3's own task spec): the SDK executor is never
// the security authority. Everything here is defense-in-depth on top of
// the real boundary, which remains scope-guard.ts's own independent
// post-hoc git-diff classification.
//
// Tool set is the literal minimum this round's task spec names in its
// own Phase 3 ("At minimum: Read, Write, Edit"), confirmed with the user
// rather than silently widened -- no Glob/Grep, no Bash. Widening this
// later (e.g. for a real task that needs repo-wide exploration) is a
// one-line, separately-reviewable change to EXECUTOR_ALLOWED_TOOLS, not
// a redesign of this module.
//
// v1.3.1 UPDATE (clean-path isolation validation round): a real,
// controlled live test proved `cwd` provides ZERO filesystem
// containment on its own -- a Read/Edit call with an absolute path
// entirely outside the approved cwd succeeded with no denial and no
// friction. The SAME round also proved, empirically, that a canUseTool
// callback that resolves the tool's own `file_path` input against cwd
// and denies anything outside it DOES provide real, working
// containment (a controlled out-of-cwd Read and Edit were both denied;
// an in-cwd Edit still succeeded normally). That is what
// createExecutorCanUseTool below now does.
//
// This required also fixing the ORIGINAL, empirically-discovered
// v1.3 gotcha (see this round's own live probe `write-probe.mjs`,
// which produced a real runtime warning: CLAUDE_SDK_CAN_USE_TOOL_
// SHADOWED): a bare tool name in `allowedTools` auto-approves BEFORE
// canUseTool is ever consulted, which would have silently bypassed
// this exact path check for Read/Write/Edit. agent-sdk-executor-
// launcher.ts's own Options no longer puts EXECUTOR_ALLOWED_TOOLS into
// `allowedTools` -- canUseTool is now the SOLE gate for every tool,
// including Read/Write/Edit, so this is no longer merely a backstop
// for unenumerated future tools; it is the real, load-bearing check.
import type { CanUseTool, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const EXECUTOR_ALLOWED_TOOLS = ["Read", "Write", "Edit"] as const;

// Explicit, not exhaustive -- see the doc comment above: canUseTool's
// fail-closed default is what actually guarantees "anything else is
// denied," this list only makes the denial happen without ever reaching
// the model (removed from its context entirely) for the specific tools
// this round's task spec calls out by name. `Task` is included
// deliberately: a spawned subagent could otherwise carry its own,
// separately-configured tool grant, which would silently widen this
// policy's own guarantee.
export const EXECUTOR_DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"] as const;

// Never "acceptEdits", never "bypassPermissions" -- this round's task
// spec explicitly forbids bypassPermissions, and "acceptEdits" is the
// exact mode the CLI transport already proved unreliable for real
// Write/Edit enforcement in non-interactive mode (see claude-cli.ts's
// own doc comment). "default" plus an explicit allowedTools/canUseTool
// pair does not depend on that prompt-based auto-accept behavior at all.
export const EXECUTOR_PERMISSION_MODE: PermissionMode = "default";

const ALLOWED_TOOL_SET: ReadonlySet<string> = new Set(EXECUTOR_ALLOWED_TOOLS);

// Resolves `candidatePath` (as the SDK's own Read/Write/Edit tools
// received it -- absolute or relative, forward or backward slashes,
// either was observed live) against `cwd`, then checks it lands inside
// it. Case-insensitive comparison: Windows paths/drive letters are not
// case-sensitive, and this round's own v1.3 work already found a real
// bug from assuming otherwise (real-executor-launcher.ts's own
// normalizeWindowsCwd). `resolve` alone (no realpath/symlink
// resolution) matches what this whole package's cwd handling already
// does elsewhere -- consistent, not a new assumption.
export function isPathWithinCwd(cwd: string, candidatePath: string): boolean {
  const resolvedCwd = resolve(cwd).toLowerCase();
  const resolvedTarget = (isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(cwd, candidatePath)).toLowerCase();
  return resolvedTarget === resolvedCwd || resolvedTarget.startsWith(resolvedCwd + sep.toLowerCase());
}

// v1.3.2 UPDATE (realpath/symlink/junction containment hardening): the
// LEXICAL check above (isPathWithinCwd, still kept -- still correct and
// still used nowhere unsafely) has a real, previously-disclosed gap: a
// path that TEXTUALLY sits inside cwd can still resolve, at the real
// filesystem level, to somewhere entirely outside it via a symlink or
// (on Windows) a directory junction/reparse point. resolveCanonical-
// Containment below closes that gap using the OS's own canonical
// resolution (`fs.realpathSync.native` -- specifically `.native`, not
// the plain `realpathSync`, because Windows junctions are only reliably
// resolved through the OS's own GetFinalPathNameByHandleW call; Node's
// pure-JS fallback has historically not always agreed with it, and
// getting this exact detail right is the entire point of this module).
//
// This is now what createExecutorCanUseTool actually calls -- it
// SUBSUMES the lexical check (the same lexical resolution is step one
// here too), so a `..` traversal or an absolute-path escape is caught
// exactly as before, in addition to every symlink/junction case.
function nativeRealpath(path: string): string {
  return realpathSync.native(path);
}

// Errors that mean "this exact path does not exist yet" -- walk up to
// the parent and try again. ENOTDIR is included alongside ENOENT: it
// occurs when an ancestor component turns out to be a plain file (e.g.
// resolving "existing-file.txt/nonexistent.txt"), which is just another
// way of saying "this exact path can't exist as such" -- the walk-up
// still correctly canonicalizes wherever "existing-file.txt" itself
// really is on the next iteration. Every OTHER error (permission
// denied, a symlink loop, anything unrecognized) is NOT treated as
// "keep walking" -- it fails the whole resolution closed instead (see
// resolveCanonicalContainment below), per this round's own explicit
// "ambiguity/error -> DENY" requirement.
function isMissingPathError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

type AncestorResolution = { realPath: string } | { error: string };

// Finds the nearest EXISTING ancestor of `absoluteTargetPath` (which may
// not exist itself -- e.g. a brand-new file a Write call is about to
// create) via the OS's own canonical resolution, then re-appends the
// non-existent remainder segments LEXICALLY -- they cannot be resolved
// any further because nothing there exists yet. This is what makes new-
// file creation both SAFE (a symlinked/junctioned ancestor is still
// found and canonicalized, so an escape through it is still caught) and
// POSSIBLE (a legitimate new file under a legitimate, real, in-cwd
// directory is never blocked merely for not existing yet, per this
// round's own explicit requirement not to weaken the policy just
// because realpath(target) can't run on something that isn't there).
function canonicalizeNearestExistingAncestor(absoluteTargetPath: string): AncestorResolution {
  let current = absoluteTargetPath;
  const remainder: string[] = [];

  for (;;) {
    try {
      const real = nativeRealpath(current);
      return { realPath: remainder.length === 0 ? real : join(real, ...remainder) };
    } catch (err) {
      if (!isMissingPathError(err)) {
        return { error: `could not resolve ${current}: ${err instanceof Error ? err.message : String(err)}` };
      }
      const parent = dirname(current);
      if (parent === current) {
        return { error: `no existing ancestor found while resolving ${absoluteTargetPath}` };
      }
      remainder.unshift(basename(current));
      current = parent;
    }
  }
}

export type CanonicalContainmentResult = { within: true; realPath: string } | { within: false; reason: string };

// The real, filesystem-aware containment decision. `cwd` itself is
// canonicalized too (defensive -- Supervisor's own cwd is always a real,
// already-git-verified directory in practice, but this never assumes
// that without checking). Any resolution failure anywhere -- including
// on cwd itself -- denies, never falls back to the lexical-only check.
export function resolveCanonicalContainment(cwd: string, candidatePath: string): CanonicalContainmentResult {
  let realCwd: string;
  try {
    realCwd = nativeRealpath(cwd);
  } catch (err) {
    return { within: false, reason: `could not resolve cwd itself (${cwd}): ${err instanceof Error ? err.message : String(err)}` };
  }

  const absoluteTarget = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(cwd, candidatePath);
  const ancestorResult = canonicalizeNearestExistingAncestor(absoluteTarget);
  if ("error" in ancestorResult) {
    return { within: false, reason: ancestorResult.error };
  }

  const normalizedCwd = realCwd.toLowerCase();
  const normalizedTarget = ancestorResult.realPath.toLowerCase();
  const within = normalizedTarget === normalizedCwd || normalizedTarget.startsWith(normalizedCwd + sep.toLowerCase());
  if (!within) {
    return {
      within: false,
      reason: `${candidatePath} canonically resolves to ${ancestorResult.realPath}, outside the approved working directory (${realCwd})`,
    };
  }
  return { within: true, realPath: ancestorResult.realPath };
}

// Fail-closed, and -- since v1.3.1 -- the REAL gate, not just a
// backstop (see this file's own top-level doc comment for why
// allowedTools can no longer carry Read/Write/Edit). For Read/Write/
// Edit: only allowed when the tool's own `file_path` input both exists
// as a string AND canonically resolves inside `cwd` (v1.3.2:
// resolveCanonicalContainment -- real symlink/junction-aware
// resolution, not just lexical); missing/wrong-typed/outside/
// unresolvable all deny. Every other tool name is denied outright,
// exactly as before. Never echoes arbitrary executor-controlled input
// back into the denial reason beyond the path itself (already visible
// to the model in its own tool call).
export function createExecutorCanUseTool(cwd: string): CanUseTool {
  return async (toolName, input) => {
    if (!ALLOWED_TOOL_SET.has(toolName)) {
      return {
        behavior: "deny",
        message: `${toolName} is not permitted for this Supervisor-managed executor session. Only Read, Write, and Edit are allowed.`,
      };
    }
    const filePath = typeof input.file_path === "string" ? input.file_path : null;
    if (filePath === null) {
      return { behavior: "deny", message: `${toolName} call carried no recognizable file_path -- denied, fail-closed.` };
    }
    const containment = resolveCanonicalContainment(cwd, filePath);
    if (!containment.within) {
      return {
        behavior: "deny",
        message: `Denied by Supervisor's own canonical path-boundary check: ${containment.reason}`,
      };
    }
    return { behavior: "allow" };
  };
}
