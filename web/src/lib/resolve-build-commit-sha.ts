// Round 10 root cause (2026-08-20): clientBuildSha (Round 9) read "unknown"
// in production despite Railway building and deploying the correct commit.
// The prior implementation (next.config.ts) shelled out to `git rev-parse
// HEAD` unconditionally -- reasonable for a plain local build, but Railway's
// build environment is a containerized Nixpacks/buildpack build that does
// not guarantee a `.git` directory (or the `git` binary itself) is present
// in the build context, so the command threw and the try/catch's fallback
// ("unknown") silently masked it every single deploy.
//
// The real, documented fix (confirmed against Railway's own docs,
// https://docs.railway.com/reference/variables and
// https://docs.railway.com/guides/frontend-environment-variables -- "On
// Railway, all service variables are available during both the build step
// and at runtime"): Railway auto-injects RAILWAY_GIT_COMMIT_SHA for every
// GitHub-triggered deployment, available during the build step itself, no
// git binary or .git directory required at all. Preferred first; `git
// rev-parse HEAD` remains as the fallback for local dev builds (where
// RAILWAY_GIT_COMMIT_SHA is never set but .git IS present) -- never
// hardcoded, both sources are real, dynamic, per-build values.
//
// Pulled into its own pure, dependency-injected function (rather than
// inlined in next.config.ts) specifically so this exact fallback chain is
// unit-testable -- next.config.ts itself is not covered by this app's test
// suite.
export interface ResolveBuildCommitShaDeps {
  env: Record<string, string | undefined>;
  execSync: (command: string) => string | Buffer;
}

export function resolveBuildCommitSha(deps: ResolveBuildCommitShaDeps): string {
  const railwaySha = deps.env.RAILWAY_GIT_COMMIT_SHA;
  if (typeof railwaySha === "string" && railwaySha.trim().length > 0) {
    return railwaySha.trim();
  }
  try {
    return deps.execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}
