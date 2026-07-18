export interface ExportRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  hairType: string;
  density: string;
  confidenceScore: number;
  createdAt: Date;
}

export class ExportService {
  static generateCSV(records: ExportRecord[]): string {
    if (records.length === 0) {
      return 'id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt\n';
    }

    const header = 'id,ownerUserId,clientId,hairType,density,confidenceScore,createdAt\n';
    const rows = records
      .map((record) => {
        const createdAtStr = record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : new Date(record.createdAt).toISOString();

        return [
          this.escapeCSV(record.id),
          this.escapeCSV(record.ownerUserId),
          this.escapeCSV(record.clientId),
          this.escapeCSV(record.hairType),
          this.escapeCSV(record.density),
          record.confidenceScore.toString(),
          createdAtStr,
        ].join(',');
      })
      .join('\n');

    return header + rows;
  }

  static generateJSON(records: ExportRecord[]): string {
    const data = records.map((record) => ({
      id: record.id,
      ownerUserId: record.ownerUserId,
      clientId: record.clientId,
      hairType: record.hairType,
      density: record.density,
      confidenceScore: record.confidenceScore,
      createdAt: record.createdAt instanceof Date
        ? record.createdAt.toISOString()
        : new Date(record.createdAt).toISOString(),
    }));

    return JSON.stringify(
      {
        status: 'success',
        data,
        meta: {
          count: records.length,
          exportedAt: new Date().toISOString(),
        },
      },
      null,
      2
    );
  }

  private static escapeCSV(value: string): string {
    // Protect against CSV formula injection
    const formulaStartChars = /^[=+\-@]/;
    let escaped = value;

    if (formulaStartChars.test(value)) {
      escaped = `'${value}`;
    }

    // Standard CSV escaping for special characters
    if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
      return `"${escaped.replace(/"/g, '""')}"`;
    }

    return escaped;
  }
}
