import { describe, expect, it } from "vitest";

import { CLI_LEGACY_TRANSPORT_ENV_VALUE, selectExecutorTransport } from "./executor-transport-selection.js";

describe("selectExecutorTransport", () => {
  it("defaults to the Agent SDK transport when the env var is unset", () => {
    expect(selectExecutorTransport({})).toEqual({ transport: "agent-sdk" });
  });

  it("selects the legacy CLI transport only on the exact opt-in value", () => {
    expect(selectExecutorTransport({ CLAUDE_SUPERVISOR_TRANSPORT: CLI_LEGACY_TRANSPORT_ENV_VALUE })).toEqual({ transport: "cli-legacy" });
  });

  // Fail-closed: anything other than the exact opt-in string -- a typo,
  // an unrelated value -- must never silently select the legacy
  // transport. The default (Agent SDK) is the safe direction to fail
  // toward.
  it("never selects the legacy transport on a near-miss value", () => {
    expect(selectExecutorTransport({ CLAUDE_SUPERVISOR_TRANSPORT: "cli_legacy" })).toEqual({ transport: "agent-sdk" });
    expect(selectExecutorTransport({ CLAUDE_SUPERVISOR_TRANSPORT: "legacy" })).toEqual({ transport: "agent-sdk" });
    expect(selectExecutorTransport({ CLAUDE_SUPERVISOR_TRANSPORT: "" })).toEqual({ transport: "agent-sdk" });
  });
});
