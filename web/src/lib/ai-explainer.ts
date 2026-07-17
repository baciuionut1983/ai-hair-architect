import type { TechnicalCutPlan } from "./contracts";

const DEFAULT_TIMEOUT_MS = 5000;

interface ExplainerPayload {
  stylistExplanation?: string;
  clientExplanation?: string;
}

export interface TechnicalExplainerProvider {
  generate(plan: TechnicalCutPlan, signal: AbortSignal): Promise<ExplainerPayload>;
}

export function createRemoteTechnicalExplainerProvider(endpoint: string, apiKey?: string): TechnicalExplainerProvider {
  return {
    async generate(plan: TechnicalCutPlan, signal: AbortSignal): Promise<ExplainerPayload> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          mode: "explanations-only",
          plan
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`AI explainer failed with status ${response.status}`);
      }

      return (await response.json()) as ExplainerPayload;
    }
  };
}

export async function enrichTechnicalPlanExplanations(
  plan: TechnicalCutPlan,
  provider?: TechnicalExplainerProvider
): Promise<TechnicalCutPlan> {
  const endpoint = process.env.AI_EXPLAINER_ENDPOINT;
  if (!endpoint && !provider) {
    return plan;
  }

  const timeoutMs = getTimeoutMs(process.env.AI_EXPLAINER_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const activeProvider = provider ?? createRemoteTechnicalExplainerProvider(endpoint ?? "", process.env.AI_EXPLAINER_API_KEY);

  try {
    const payload = await activeProvider.generate(plan, controller.signal);
    const validStylist = typeof payload.stylistExplanation === "string" && payload.stylistExplanation.trim().length > 0;
    const validClient = typeof payload.clientExplanation === "string" && payload.clientExplanation.trim().length > 0;

    if (!validStylist && !validClient) {
      return {
        ...plan,
        warnings: appendUnique(plan.warnings, "AI explanation service returned an invalid payload. Deterministic explanations used.")
      };
    }

    return {
      ...plan,
      stylistExplanation: safeExplanation(payload.stylistExplanation, plan.stylistExplanation),
      clientExplanation: safeExplanation(payload.clientExplanation, plan.clientExplanation)
    };
  } catch {
    return {
      ...plan,
      warnings: appendUnique(plan.warnings, "AI explanation service unavailable. Deterministic explanations used.")
    };
  } finally {
    clearTimeout(timer);
  }
}

function getTimeoutMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 500) {
    return DEFAULT_TIMEOUT_MS;
  }

  return parsed;
}

function safeExplanation(value: string | undefined, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

function appendUnique(list: string[], item: string): string[] {
  if (list.includes(item)) {
    return list;
  }

  return [...list, item];
}
