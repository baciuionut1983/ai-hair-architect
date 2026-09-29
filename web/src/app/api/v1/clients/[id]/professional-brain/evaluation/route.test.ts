import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const orchestratorMock = vi.hoisted(() => {
  class ProfessionalBrainAccessError extends Error {
    readonly code = "PROFESSIONAL_BRAIN_CLIENT_NOT_FOUND";
    readonly httpStatus = 404;
    constructor() {
      super("Client not found.");
      this.name = "ProfessionalBrainAccessError";
    }
  }
  class ProfessionalBrainStateError extends Error {
    readonly httpStatus = 409;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProfessionalBrainStateError";
    }
  }
  return {
    ProfessionalBrainAccessError,
    ProfessionalBrainStateError,
    loadProfessionalBrainState: vi.fn(),
    selectCandidateSkillsForDomains: vi.fn(),
    resolveEvaluationDomainIntent: vi.fn(() => ({ domains: ["cut", "color"] })),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => ({ ...clientRepoMock }));
vi.mock("@/lib/professional-brain-orchestrator", () => orchestratorMock);

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "client-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue({ id: "user-1" });
  clientRepoMock.resolveOwnedClient.mockResolvedValue({ id: "client-1", ownerUserId: "user-1" });
});

describe("GET /clients/[id]/professional-brain/evaluation", () => {
  it("401 when unauthenticated", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const res = await GET(new Request("http://x"), params);
    expect(res.status).toBe(401);
  });

  it("404 when the client is not owned", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const res = await GET(new Request("http://x"), params);
    expect(res.status).toBe(404);
    expect(orchestratorMock.loadProfessionalBrainState).not.toHaveBeenCalled();
  });

  it("evaluation is null when there is no CURRENT/TARGET snapshot yet -- selectCandidateSkillsForDomains is never called", async () => {
    orchestratorMock.loadProfessionalBrainState.mockResolvedValue({ currentSnapshot: null, targetSnapshot: null });
    const res = await GET(new Request("http://x"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({ currentSnapshot: null, targetSnapshot: null, evaluation: null, stylingGap: null });
    expect(orchestratorMock.selectCandidateSkillsForDomains).not.toHaveBeenCalled();
  });

  it("evaluation stays null while only one side is CONFIRMED (the other still DRAFT)", async () => {
    orchestratorMock.loadProfessionalBrainState.mockResolvedValue({
      currentSnapshot: { id: "c1", status: "CONFIRMED", payload: {} },
      targetSnapshot: { id: "t1", status: "DRAFT" },
    });
    const res = await GET(new Request("http://x"), params);
    const json = await res.json();
    expect(json.evaluation).toBeNull();
    expect(json.stylingGap).toBeNull();
    expect(orchestratorMock.selectCandidateSkillsForDomains).not.toHaveBeenCalled();
  });

  it("computes and returns the domain-scoped evaluation once BOTH snapshots are CONFIRMED", async () => {
    orchestratorMock.loadProfessionalBrainState.mockResolvedValue({
      currentSnapshot: { id: "c1", status: "CONFIRMED", payload: {} },
      targetSnapshot: { id: "t1", status: "CONFIRMED" },
    });
    orchestratorMock.resolveEvaluationDomainIntent.mockReturnValue({ domains: ["cut", "color"] });
    orchestratorMock.selectCandidateSkillsForDomains.mockResolvedValue({
      delta: { entries: [{ scope: "global", field: "colorLevel", transformation: "INCREASED" }] },
      candidateMatches: [{ skillKey: "skill-color-global-single-process-evaluation-gate", matchedCapability: "EVALUATE_COLOR_SERVICE" }],
      rejectedMatches: [],
      unresolvedDeltas: [],
    });
    const res = await GET(new Request("http://x"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.evaluation.candidateMatches).toHaveLength(1);
    expect(json.stylingGap).toBeNull();
    expect(orchestratorMock.selectCandidateSkillsForDomains).toHaveBeenCalledWith("user-1", "client-1");
  });

  it("STYLING in the domain intent: returns the real gap report, never calls selectCandidateSkillsForDomains, never fabricates an evaluation", async () => {
    orchestratorMock.loadProfessionalBrainState.mockResolvedValue({
      currentSnapshot: { id: "c1", status: "CONFIRMED", payload: { evaluationDomainIntent: { domains: ["cut", "styling"] } } },
      targetSnapshot: { id: "t1", status: "CONFIRMED" },
    });
    orchestratorMock.resolveEvaluationDomainIntent.mockReturnValue({ domains: ["cut", "styling"] });
    const res = await GET(new Request("http://x"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.evaluation).toBeNull();
    expect(json.stylingGap).toBeTruthy();
    expect(json.stylingGap.domain).toBe("styling");
    expect(json.stylingGap.missingContracts.length).toBeGreaterThan(0);
    expect(orchestratorMock.selectCandidateSkillsForDomains).not.toHaveBeenCalled();
  });

  it("STATIC PROOF -- the route source never references reasoning/execution-plan/scene-plan/reasoning-provider functions; this route stops at delta+candidates", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/prepareReasoningRequestPackage|prepareMultiDomainReasoningRequestPackage|approveReasoningProposal|compileAndPersistExecutionPlan|compileAndPersistScenePlan|professional-reasoning-provider/);
  });
});
