import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  AuditLogAction,
  AuditLogTargetType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import type { AuditLogListQuery } from './audit-logs.dto.js';

type Transaction = Prisma.TransactionClient;

export interface AuditLogEntry {
  organizationId: string;
  actorId: string;
  action: AuditLogAction;
  targetType: AuditLogTargetType;
  targetId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export interface AuditLogItem {
  id: string;
  organizationId: string;
  actorId: string;
  actorName: string;
  action: AuditLogAction;
  targetType: AuditLogTargetType;
  targetId: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  static async record(
    transaction: Transaction,
    entry: AuditLogEntry,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
      },
      select: { id: true },
    });
  }

  async list(
    organizationId: string,
    userId: string,
    query: AuditLogListQuery,
  ): Promise<AuditLogPage> {
    return this.prisma.$transaction(async (transaction) => {
      const membership =
        await transaction.organizationMembership.findFirst({
          where: {
            organizationId,
            userId,
            status: 'ACTIVE',
            organization: { status: 'ACTIVE' },
          },
          select: { role: true },
        });
      if (!membership) {
        throw new NotFoundException('Organization not found.');
      }
      if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
        throw new ForbiddenException(
          'Only organization Owners and Admins can view audit logs.',
        );
      }

      const createdAt =
        query.from || query.to
          ? {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            }
          : undefined;
      const where: Prisma.AuditLogWhereInput = {
        organizationId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(createdAt ? { createdAt } : {}),
      };
      const rows = await transaction.auditLog.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          actorId: true,
          actor: { select: { name: true } },
          action: true,
          targetType: true,
          targetId: true,
          before: true,
          after: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize + 1,
      });

      const hasMore = rows.length > query.pageSize;
      return {
        items: rows.slice(0, query.pageSize).map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          actorId: row.actorId,
          actorName: row.actor.name,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          before: row.before,
          after: row.after,
          createdAt: row.createdAt,
        })),
        page: query.page,
        pageSize: query.pageSize,
        hasMore,
      };
    });
  }
}
