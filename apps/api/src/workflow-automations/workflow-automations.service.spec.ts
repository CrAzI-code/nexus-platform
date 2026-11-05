import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import { WorkflowAutomationsService } from './workflow-automations.service.js';

describe('WorkflowAutomationsService', () => {
  const transaction = {
    organizationMembership: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    projectMember: { findFirst: vi.fn() },
    workflowAutomation: { findMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };
  let service: WorkflowAutomationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    transaction.projectMember.findFirst.mockResolvedValue({ id: 'member-id' });
    service = new WorkflowAutomationsService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );
  });

  it('denies automation access to non-manager project members', async () => {
    await expect(
      service.list('organization-id', 'project-id', 'member-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(transaction.workflowAutomation.findMany).not.toHaveBeenCalled();
  });

  it('treats a duplicate event execution key as an already-claimed event', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint conflict',
      { code: 'P2002', clientVersion: 'test' },
    );
    const notifications = {
      withTransaction: vi.fn().mockRejectedValue(duplicate),
    };
    service = new WorkflowAutomationsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
    const candidate = {
      ruleId: 'rule-id',
      organizationId: 'organization-id',
      projectId: 'project-id',
      taskId: 'task-id',
      trigger: 'TASK_CREATED' as const,
      eventKey: 'activity:activity-id',
    };
    const runCandidate = (
      service as unknown as {
        runCandidate: (value: typeof candidate) => Promise<void>;
      }
    ).runCandidate;

    await expect(runCandidate.call(service, candidate)).resolves.toBeUndefined();
    expect(notifications.withTransaction).toHaveBeenCalledOnce();
  });
});