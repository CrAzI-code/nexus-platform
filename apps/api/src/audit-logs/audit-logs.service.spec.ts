import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service.js';
import { AuditLogsService } from './audit-logs.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const row = {
  id: 'log-id',
  organizationId: 'organization-id',
  actorId: 'actor-id',
  actor: { name: 'Organization Admin' },
  action: 'PROJECT_UPDATED',
  targetType: 'PROJECT',
  targetId: 'project-id',
  before: { name: 'Before' },
  after: { name: 'After' },
  createdAt: new Date('2026-11-02T10:00:00.000Z'),
};

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  const transaction = {
    organizationMembership: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'OWNER',
    });
    transaction.auditLog.findMany.mockResolvedValue([
      row,
      { ...row, id: 'next-log-id' },
    ]);
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(AuditLogsService);
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'allows %s to read only their organization audit entries',
    async (role) => {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      await expect(
        service.list('organization-id', 'actor-id', {
          page: 2,
          pageSize: 1,
          action: 'PROJECT_UPDATED',
          actorId: 'actor-id',
          targetType: 'PROJECT',
          targetId: 'project-id',
          from: new Date('2026-11-01T00:00:00.000Z'),
          to: new Date('2026-11-03T00:00:00.000Z'),
        }),
      ).resolves.toEqual({
        items: [
          {
            id: 'log-id',
            organizationId: 'organization-id',
            actorId: 'actor-id',
            actorName: 'Organization Admin',
            action: 'PROJECT_UPDATED',
            targetType: 'PROJECT',
            targetId: 'project-id',
            before: { name: 'Before' },
            after: { name: 'After' },
            createdAt: row.createdAt,
          },
        ],
        page: 2,
        pageSize: 1,
        hasMore: true,
      });

      expect(transaction.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'organization-id',
            action: 'PROJECT_UPDATED',
            actorId: 'actor-id',
            targetType: 'PROJECT',
            targetId: 'project-id',
            createdAt: {
              gte: new Date('2026-11-01T00:00:00.000Z'),
              lte: new Date('2026-11-03T00:00:00.000Z'),
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 1,
          take: 2,
        }),
      );
    },
  );

  it.each(['MANAGER', 'MEMBER'] as const)(
    'rejects %s without querying audit records',
    async (role) => {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      await expect(
        service.list('organization-id', 'actor-id', {
          page: 1,
          pageSize: 25,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction.auditLog.findMany).not.toHaveBeenCalled();
    },
  );

  it('does not disclose audit-log existence to non-members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue(null);
    await expect(
      service.list('another-organization-id', 'actor-id', {
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('scopes every retrieval to the authorized organization', async () => {
    await service.list('organization-id', 'actor-id', {
      page: 1,
      pageSize: 25,
      targetId: 'project-id',
    });
    const [args] = transaction.auditLog.findMany.mock.calls[0] ?? [];
    expect(args.where.organizationId).toBe('organization-id');
  });
});
