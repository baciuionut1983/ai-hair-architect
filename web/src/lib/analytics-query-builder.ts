import { prisma } from '@/lib/prisma';

// Maximum records per query to prevent memory exhaustion
// Reasoning: ORM loads all records into memory for JavaScript aggregation
// 10,000 records ≈ 2-3 MB memory, acceptable for typical HTTP request timeout
// Beyond this limit: risk of memory pressure and slow response times
export const MAX_ANALYTICS_RECORDS_PER_QUERY = 10_000;

export class AnalyticsQueryLimitExceededError extends Error {
  constructor(recordCount: number) {
    super(
      `Query would return ${recordCount} records, exceeding limit of ${MAX_ANALYTICS_RECORDS_PER_QUERY}. ` +
      `Use pagination or narrow the date range.`
    );
    this.name = 'AnalyticsQueryLimitExceededError';
  }
}

export interface AnalyticsQuery {
  userId: string;
  dateFrom: Date;
  dateTo: Date;
  scope?: 'personal' | 'all'; // For authorization
}

export interface MetricsResult {
  summary: {
    totalAnalyses: number;
    avgConfidence: number;
    mostCommonHairType: string | null;
    mostCommonDensity: string | null;
    uniqueUsers?: number;
    uniqueClients: number;
  };
  byHairType: Array<{ hairType: string; count: number; avgConfidence: number }>;
  byDensity: Array<{ density: string; count: number; avgConfidence: number }>;
  confidence: {
    min: number;
    max: number;
    mean: number;
    median: number;
    stdev: number;
  };
}

export class AnalyticsQueryBuilder {
  static async buildMetrics(query: AnalyticsQuery): Promise<MetricsResult> {
    const { userId, dateFrom, dateTo, scope } = query;

    // Use Prisma ORM for reliable date filtering instead of $queryRaw parameters
    const records = await prisma.analysis.findMany({
      where: {
        ...(scope === 'personal' && { ownerUserId: userId }),
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      select: {
        confidenceScore: true,
        clientId: true,
        hairType: true,
        density: true,
        ownerUserId: true,
      },
    });

    // Check volume limit to prevent memory exhaustion
    if (records.length > MAX_ANALYTICS_RECORDS_PER_QUERY) {
      throw new AnalyticsQueryLimitExceededError(records.length);
    }

    // If no records, return empty result
    if (records.length === 0) {
      return {
        summary: {
          totalAnalyses: 0,
          avgConfidence: 0,
          mostCommonHairType: null,
          mostCommonDensity: null,
          uniqueUsers: scope === 'all' ? 0 : undefined,
          uniqueClients: 0,
        },
        byHairType: [],
        byDensity: [],
        confidence: {
          min: 0,
          max: 0,
          mean: 0,
          median: 0,
          stdev: 0,
        },
      };
    }

    // Aggregate data in JavaScript
    const totalAnalyses = records.length;
    const avgConfidence = records.reduce((sum, r) => sum + r.confidenceScore, 0) / records.length;
    const uniqueClients = new Set(records.map(r => r.clientId)).size;

    // Most common hair type
    const hairTypeCounts = new Map<string, { count: number; totalConfidence: number }>();
    records.forEach(r => {
      if (r.hairType) {
        const existing = hairTypeCounts.get(r.hairType) || { count: 0, totalConfidence: 0 };
        hairTypeCounts.set(r.hairType, {
          count: existing.count + 1,
          totalConfidence: existing.totalConfidence + r.confidenceScore,
        });
      }
    });
    let mostCommonHairType: string | null = null;
    let maxHairTypeCount = 0;
    hairTypeCounts.forEach((data, type) => {
      if (data.count > maxHairTypeCount) {
        maxHairTypeCount = data.count;
        mostCommonHairType = type;
      }
    });

    // Most common density
    const densityCounts = new Map<string, { count: number; totalConfidence: number }>();
    records.forEach(r => {
      if (r.density) {
        const existing = densityCounts.get(r.density) || { count: 0, totalConfidence: 0 };
        densityCounts.set(r.density, {
          count: existing.count + 1,
          totalConfidence: existing.totalConfidence + r.confidenceScore,
        });
      }
    });
    let mostCommonDensity: string | null = null;
    let maxDensityCount = 0;
    densityCounts.forEach((data, type) => {
      if (data.count > maxDensityCount) {
        maxDensityCount = data.count;
        mostCommonDensity = type;
      }
    });

    // Confidence statistics
    const confidences = records.map(r => r.confidenceScore).sort((a, b) => a - b);
    const min = Math.min(...confidences);
    const max = Math.max(...confidences);
    const mean = avgConfidence;
    const median = confidences.length % 2 === 0
      ? (confidences[confidences.length / 2 - 1] + confidences[confidences.length / 2]) / 2
      : confidences[Math.floor(confidences.length / 2)];

    // Calculate standard deviation (population)
    const variance = records.reduce((sum, r) => sum + Math.pow(r.confidenceScore - mean, 2), 0) / records.length;
    const stdev = Math.sqrt(variance);

    // Unique users for all-scope
    let uniqueUsers: number | undefined;
    if (scope === 'all') {
      uniqueUsers = new Set(records.map(r => r.ownerUserId)).size;
    }

    return {
      summary: {
        totalAnalyses,
        avgConfidence,
        mostCommonHairType,
        mostCommonDensity,
        uniqueUsers,
        uniqueClients,
      },
      byHairType: Array.from(hairTypeCounts, ([type, data]) => ({
        hairType: type,
        count: data.count,
        avgConfidence: data.totalConfidence / data.count,
      })).sort((a, b) => b.count - a.count),
      byDensity: Array.from(densityCounts, ([type, data]) => ({
        density: type,
        count: data.count,
        avgConfidence: data.totalConfidence / data.count,
      })).sort((a, b) => b.count - a.count),
      confidence: {
        min,
        max,
        mean,
        median,
        stdev,
      },
    };
  }

  static async buildExportData(query: AnalyticsQuery & { scope: 'personal' | 'all' }) {
    const { userId, dateFrom, dateTo, scope } = query;

    return prisma.analysis.findMany({
      where: {
        ...(scope === 'personal' && { ownerUserId: userId }),
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      select: {
        id: true,
        ownerUserId: true,
        clientId: true,
        hairType: true,
        density: true,
        porosity: true,
        confidenceScore: true,
        createdAt: true,
      },
    });
  }
}
