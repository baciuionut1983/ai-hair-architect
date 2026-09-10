import { loadProfessionalBrainState } from "@/lib/professional-brain-orchestrator";
import { buildPipelineStatusView } from "@/lib/professional-brain-pipeline-status";
import { serializeVisualInstructionPackageToProviderInstruction } from "@/lib/professional-visual-instruction-provider-serializer";
import { summarizeTechnicalRenderProviderConfig, type TechnicalRenderProviderConfigSummary } from "@/lib/technical-render-provider-config";
import type { VisualEvidenceReference } from "@/lib/professional-visual-instruction-contracts";

// AI Hair Architect, Stage 8.5A -- PRE-RENDER DRY RUN (Part AA). The main
// zero-cost pre-render diagnostic. It composes the orchestrator's loaded
// state, the Stage 8 per-scene Render Readiness result, the provider
// config summary, and the provider serializer -- and reports whether a
// real render request WOULD be allowed, plus every blocker.
//
// IT NEVER SENDS A PROVIDER REQUEST. It never constructs a real
// generation job, never creates a providerOperationId, never polls,
// never reads or logs a secret (only PRESENT/MISSING via
// summarizeTechnicalRenderProviderConfig). It exists precisely so a
// human can see exactly what stands between "pipeline compiled" and "one
// authorized real render" without spending anything.

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface ProfessionalBrainRenderDryRunResult {
  clientId: string;
  requestedSceneId: string;
  pipelineStatus: ReturnType<typeof buildPipelineStatusView>;
  sceneFound: boolean;
  sceneFingerprint: string | null;
  packageFingerprint: string | null;
  renderReadiness: string | null;
  renderReadinessReasons: readonly string[];
  sourceImage: VisualEvidenceReference | null;
  providerConfig: TechnicalRenderProviderConfigSummary;
  providerInstructionFingerprint: string | null;
  // technically render-ready AND professionally approved (scene plan
  // CONFIRMED) AND provider configured AND serializer accepted.
  requestWouldBeAllowed: boolean;
  // ALWAYS false in Stage 8.5A -- no dry run ever sends.
  providerRequestSent: false;
  blockers: readonly string[];
}

export async function professionalBrainRenderDryRun(
  ownerUserId: string,
  clientId: string,
  requestedSceneId: string,
  env: EnvironmentSource,
): Promise<ProfessionalBrainRenderDryRunResult> {
  const state = await loadProfessionalBrainState(ownerUserId, clientId);
  const pipelineStatus = buildPipelineStatusView(state);
  const providerConfig = summarizeTechnicalRenderProviderConfig(env);
  const blockers: string[] = [];

  const scene = state.scenePlan?.scenePlan.scenes.find((s) => s.sceneId === requestedSceneId) ?? null;
  const pkg = state.visualPackages.find((p) => p.sourceSceneId === requestedSceneId) ?? null;
  const readiness = state.sceneReadiness.find((s) => s.sceneId === requestedSceneId)?.result ?? null;

  if (!state.scenePlan) blockers.push("No CONFIRMED scene plan exists for this client yet.");
  if (state.scenePlan && !scene) blockers.push(`Scene "${requestedSceneId}" does not exist in the current scene plan.`);
  if (state.scenePlan && state.scenePlan.status !== "CONFIRMED") blockers.push("The scene plan is not professionally CONFIRMED (spend authorization missing).");
  if (readiness && readiness.status !== "RENDER_READY") {
    blockers.push(`Render Readiness for this scene is "${readiness.status}".`);
    for (const f of readiness.findings) if (f.reason !== "PROFESSIONAL_APPROVAL_REQUIRED") blockers.push(`readiness: ${f.reason}`);
  }
  if (providerConfig.status !== "configured") {
    blockers.push(...providerConfig.issues.map((i) => `provider config: ${i}`));
  }

  let providerInstructionFingerprint: string | null = null;
  let sourceImage: VisualEvidenceReference | null = null;

  if (scene && pkg && readiness && providerConfig.status === "configured") {
    const primary = pkg.sourceVisualEvidence.find((e) => e.evidenceRole === "PRIMARY_CAPTURE") ?? null;
    sourceImage = primary;
    if (!primary && pkg.visualEvidenceRequired) {
      blockers.push("No PRIMARY_CAPTURE source image reference is bound to this scene's package.");
    } else if (primary) {
      const serialized = serializeVisualInstructionPackageToProviderInstruction({
        package: pkg,
        readinessResult: readiness,
        sourceImage: primary,
        provider: providerConfig.provider ?? "",
        model: providerConfig.model ?? "",
      });
      if (serialized.status === "SERIALIZED") {
        providerInstructionFingerprint = serialized.instruction.providerInstructionFingerprint;
      } else {
        blockers.push(`serializer: ${serialized.reason}`);
      }
    }
  }

  const requestWouldBeAllowed =
    !!scene &&
    !!pkg &&
    readiness?.status === "RENDER_READY" &&
    state.scenePlan?.status === "CONFIRMED" &&
    providerConfig.status === "configured" &&
    providerInstructionFingerprint !== null &&
    blockers.length === 0;

  return {
    clientId,
    requestedSceneId,
    pipelineStatus,
    sceneFound: !!scene,
    sceneFingerprint: scene?.sceneFingerprint ?? null,
    packageFingerprint: pkg?.packageFingerprint ?? null,
    renderReadiness: readiness?.status ?? null,
    renderReadinessReasons: readiness ? readiness.findings.map((f) => f.reason) : [],
    sourceImage,
    providerConfig,
    providerInstructionFingerprint,
    requestWouldBeAllowed,
    providerRequestSent: false,
    blockers,
  };
}
