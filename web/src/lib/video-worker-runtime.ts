// Real AI Video Demonstration, Stage 3 -- the scheduler-facing entry
// point. Finds every generation due for work right now and runs the
// existing, unmodified executeVideoDemonstrationGeneration orchestrator
// for each -- this file contributes no new claim/execution logic of its
// own, only cross-generation sweep orchestration (see
// video-worker-recovery.ts for why no sweep-level lock is added on top of
// the per-row atomic claims that already exist).

import { findDueVideoDemonstrationGenerationsForRecovery } from "@/lib/video-generation-execution-repository";
import { executeVideoDemonstrationGeneration } from "@/lib/video-generation-execution-service";
import { runVideoDemonstrationRecoverySweep, type VideoDemonstrationRecoverySweepResult } from "@/lib/video-worker-recovery";

const MAX_GENERATIONS_PER_RUN = 100;
const MAX_CONCURRENCY = 5;

export async function runVideoDemonstrationRecoverySweepForRuntime(): Promise<VideoDemonstrationRecoverySweepResult> {
  return runVideoDemonstrationRecoverySweep({
    now: () => new Date(),
    maxGenerationsPerRun: MAX_GENERATIONS_PER_RUN,
    maxConcurrency: MAX_CONCURRENCY,
    findDueGenerations: (now, limit) => findDueVideoDemonstrationGenerationsForRecovery(now, limit),
    executeGeneration: (generationId, ownerUserId) => executeVideoDemonstrationGeneration(generationId, ownerUserId),
  });
}
