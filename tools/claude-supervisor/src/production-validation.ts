// Pure logic for the human production-validation gate -- see this
// round's own task spec Phase 8. The actual PRODUCTION_VALIDATED /
// HUMAN_REJECTED decision already lives in decide-next-action.ts's own
// HUMAN_DECISION case (unchanged from v1); this module's only job is
// (a) deciding WHETHER a task needs this gate at all, and (b) building
// the request a human sees -- deliberately GENERIC, never a fabricated
// test plan: the Supervisor cannot actually know the real functional
// specifics of an arbitrary future task, and inventing plausible-
// looking ones would violate this whole project's own "do not guess"
// discipline (see Phase E's own report on this exact point).
import type { TaskContract } from "./types.js";

export function needsProductionValidation(contract: TaskContract): boolean {
  return contract.productionValidation === "required";
}

export interface ProductionValidationRequest {
  taskId: string;
  title: string;
  commitSha: string;
  testMatrix: readonly string[];
  expectedTelemetry: readonly string[];
}

export function buildProductionValidationRequest(contract: TaskContract, commitSha: string): ProductionValidationRequest {
  return {
    taskId: contract.taskId,
    title: contract.title,
    commitSha,
    testMatrix: [
      `Deploy/redeploy commit ${commitSha} to production if this platform does not auto-deploy on push.`,
      `Exercise the real feature described in this task's own scope: ${contract.scope.join(", ") || "(none declared)"}.`,
      `Confirm no regression in any area this task declared protected: ${contract.protectedAreas.join(", ") || "(none declared)"}.`,
    ],
    expectedTelemetry: [
      "Confirm no new error-rate increase in production logs/telemetry for the affected area.",
      `Confirm the behavior change described in the task title ("${contract.title}") is actually observable in a real production session.`,
    ],
  };
}
