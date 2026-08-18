import type { AiUsageCostBasis, AiUsageModality } from "./ai-usage-contracts";
import type { AiUsageQuantities } from "./ai-usage-contracts";

// AI Usage & Cost Metering Phase 1: the ONE place a provider price is
// ever multiplied against a usage quantity. Every rate is expressed in
// MICROS (1,000,000 micros = 1 unit of `currency`) per single unit of the
// billable quantity (per token, per second, per character, per image) --
// never per-thousand/per-million the way providers often quote list
// prices, so this function never needs to know which scale a given
// provider's docs use; that conversion happens once, when the rate is
// configured, not on every calculation. Micros (not cents, unlike
// BillingPayment.amountCents) because a single AI call routinely costs a
// small fraction of one cent -- whole-cent precision would round nearly
// every real event to zero.
export interface AiUsagePricingRate {
  inputTokenMicros?: number;
  outputTokenMicros?: number;
  cachedInputTokenMicros?: number;
  reasoningTokenMicros?: number;
  audioInputSecondMicros?: number;
  audioOutputSecondMicros?: number;
  characterMicros?: number;
  imageMicros?: number;
  videoSecondMicros?: number;
}

export interface AiUsagePricingEntry {
  provider: string;
  model: string;
  modality: AiUsageModality;
  currency: string;
  rate: AiUsagePricingRate;
}

// A pricing table is a single, named, immutable snapshot -- `version` is
// what every priced AiUsageEvent stores alongside its own computed cost
// (see ai-usage-repository.ts), so a later change to `entries` (a real
// provider price change, or finally configuring a price that was
// UNAVAILABLE before) can never silently rewrite the meaning of a cost
// already recorded under an earlier version. Historical cost is
// preserved by never recomputing it, not by snapshotting the whole table
// into every row.
export interface AiUsagePricingTable {
  version: string;
  entries: AiUsagePricingEntry[];
}

// IMPORTANT: this ships with ZERO priced entries. Real Gemini/OpenAI/
// Anthropic per-token/per-second/per-image prices are not hardcoded here
// from memory -- the AI Usage & Cost Metering Phase 1 task this shipped
// under explicitly required never inventing a provider price without an
// authoritative source, and pricing genuinely does change over time. An
// operator configures real prices via AI_USAGE_PRICING_TABLE_JSON (see
// loadPricingTable below) once real figures are confirmed; until then,
// every event this resolver prices honestly comes back UNAVAILABLE
// (estimatedCostMicros stays null) rather than showing a fabricated
// number that looks authoritative but isn't.
export const EMPTY_PRICING_TABLE: AiUsagePricingTable = {
  version: "unconfigured-v0",
  entries: [],
};

const PRICING_ENV_VAR = "AI_USAGE_PRICING_TABLE_JSON";

// Reads an operator-supplied pricing table from the environment, once per
// call (never cached at module scope) so a rotated/corrected price takes
// effect on the next request without requiring a process restart --
// mirrors retention-automation-auth.ts's own "read fresh every time"
// convention for exactly the same reason. Malformed JSON or a structurally
// invalid table fails closed to EMPTY_PRICING_TABLE (never throws, never
// guesses) -- a configuration mistake must degrade to "cost unavailable",
// never to a wrong number.
export function loadPricingTable(env: Readonly<Record<string, string | undefined>> = process.env): AiUsagePricingTable {
  const raw = env[PRICING_ENV_VAR];
  if (!raw || raw.trim().length === 0) {
    return EMPTY_PRICING_TABLE;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPricingTable(parsed)) {
      return EMPTY_PRICING_TABLE;
    }
    return parsed;
  } catch {
    return EMPTY_PRICING_TABLE;
  }
}

function isValidPricingTable(value: unknown): value is AiUsagePricingTable {
  if (typeof value !== "object" || value === null) return false;
  const table = value as Record<string, unknown>;
  if (typeof table.version !== "string" || table.version.trim().length === 0) return false;
  if (!Array.isArray(table.entries)) return false;
  return table.entries.every(isValidPricingEntry);
}

function isValidPricingEntry(value: unknown): value is AiUsagePricingEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.provider === "string" &&
    typeof entry.model === "string" &&
    typeof entry.modality === "string" &&
    typeof entry.currency === "string" &&
    entry.currency.trim().length === 3 &&
    typeof entry.rate === "object" &&
    entry.rate !== null
  );
}

export interface ResolveAIProviderCostInput {
  provider: string;
  model: string;
  modality: AiUsageModality;
  usage: AiUsageQuantities | undefined;
  usageAvailable: boolean;
  pricingTable: AiUsagePricingTable;
}

export interface ResolveAIProviderCostResult {
  estimatedCostMicros: bigint | null;
  currency: string | null;
  pricingVersion: string;
  costBasis: AiUsageCostBasis;
}

const RATE_TO_QUANTITY: ReadonlyArray<[keyof AiUsagePricingRate, keyof AiUsageQuantities]> = [
  ["inputTokenMicros", "inputTokens"],
  ["outputTokenMicros", "outputTokens"],
  ["cachedInputTokenMicros", "cachedInputTokens"],
  ["reasoningTokenMicros", "reasoningTokens"],
  ["audioInputSecondMicros", "audioInputSeconds"],
  ["audioOutputSecondMicros", "audioOutputSeconds"],
  ["characterMicros", "characterCount"],
  ["imageMicros", "imageCount"],
  ["videoSecondMicros", "videoSeconds"],
];

// resolveAIProviderCost({provider, model, modality, usage, pricingVersion})
// as the task's own spec named it -- pricingVersion is implicit here
// (carried by `pricingTable`, whose own `version` field is what the
// result reports back) rather than a separate parameter, since a caller
// can only ever mean "price this against THIS table," never "against
// version X of some table I'm not also providing."
export function resolveAIProviderCost(input: ResolveAIProviderCostInput): ResolveAIProviderCostResult {
  const { pricingTable } = input;

  if (!input.usageAvailable || !input.usage) {
    return { estimatedCostMicros: null, currency: null, pricingVersion: pricingTable.version, costBasis: "UNAVAILABLE" };
  }

  const entry = pricingTable.entries.find(
    (candidate) => candidate.provider === input.provider && candidate.model === input.model && candidate.modality === input.modality,
  );
  if (!entry) {
    return { estimatedCostMicros: null, currency: null, pricingVersion: pricingTable.version, costBasis: "UNAVAILABLE" };
  }

  let totalMicros = 0;
  let pricedAnyQuantity = false;
  for (const [rateKey, quantityKey] of RATE_TO_QUANTITY) {
    const rate = entry.rate[rateKey];
    const quantity = input.usage[quantityKey];
    if (typeof rate !== "number" || typeof quantity !== "number") continue;
    totalMicros += rate * quantity;
    pricedAnyQuantity = true;
  }

  if (!pricedAnyQuantity) {
    return { estimatedCostMicros: null, currency: null, pricingVersion: pricingTable.version, costBasis: "UNAVAILABLE" };
  }

  return {
    estimatedCostMicros: BigInt(Math.round(totalMicros)),
    currency: entry.currency,
    pricingVersion: pricingTable.version,
    costBasis: "CALCULATED",
  };
}
