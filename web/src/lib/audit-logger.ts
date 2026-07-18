import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export type AuditAction =
  | 'query_metrics'
  | 'export_csv'
  | 'export_json'
  | 'volume_limit_exceeded'
  | 'access_denied';

export type AuditResourceType = 'analytics' | 'export' | 'admin';

export type AuditStatus = 'success' | 'failure';

export interface AuditEvent {
  actorUserId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  status: AuditStatus;
  metadata: Prisma.InputJsonValue;
  resourceId?: string;
}

export class AuditLogger {
  static async log(event: AuditEvent): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: event.actorUserId,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId || null,
          status: event.status,
          metadata: event.metadata,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AUDIT_ERROR] Failed to log audit event: ${errorMessage}`);
    }
  }
}
