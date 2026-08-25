// Supervisor v1.3 -- executor transport selection. Pure, fully tested:
// decides which ExecutorLauncher implementation cli.ts should construct.
// Default is the Agent SDK transport (v1.3's own migration target); the
// legacy `claude -p` CLI transport is reachable only via an explicit
// opt-in env var, never automatically, and never as a silent fallback
// if the SDK path fails to construct -- see this round's own Phase 10
// ("fail closed... selection must be explicit").
export const CLI_LEGACY_TRANSPORT_ENV_VALUE = "cli-legacy";

export type ExecutorTransportSelection = { transport: "agent-sdk" } | { transport: "cli-legacy" };

export function selectExecutorTransport(env: NodeJS.ProcessEnv): ExecutorTransportSelection {
  if (env.CLAUDE_SUPERVISOR_TRANSPORT === CLI_LEGACY_TRANSPORT_ENV_VALUE) {
    return { transport: "cli-legacy" };
  }
  return { transport: "agent-sdk" };
}
