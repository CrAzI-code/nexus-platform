import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { TaskActivityType } from '../generated/prisma/client.js';
import type { NewNotification } from '../notifications/notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import { TasksService } from './tasks.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskRow = {
  id: 'task-id',
  organizationId: 'organization-id',
  projectId: 'project-id',
  title: 'Prepare launch',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  dueAt: null,
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  project: { name: 'Launch' },
  creator: {
    userId: 'verified-user-id',
    membership: { user: { name: 'Jordan Wells' } },
  },
  assignee: null,
  _count: { comments: 0 },
};

const taskDetails = {
  ...taskRow,
  comments: [],
  activities: [],
};

function detailsWithActivity(
  type: TaskActivityType,
  actorName = 'Jordan Wells',
) {
  return {
    ...taskDetails,
    activities: [
      {
        id: `activity-${type.toLowerCase()}`,
        actorId: 'verified-user-id',
        type,
        message: 'Recorded task action.',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        actor: {
          membership: { user: { name: actorName } },
        },
      },
    ],
  };
}

describe('TasksService', () => {
  let service: TasksService;
  const transaction = {
    organizationMembership: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    projectMember: { findFirst: vi.fn(), findMany: vi.fn() },
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    taskComment: { create: vi.fn(), findMany: vi.fn() },
    taskActivity: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { createMany: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  const notifications = {
    withTransaction: vi.fn(
      async <T>(
        operation: (
          tx: typeof transaction,
          publish: (items: NewNotification[]) => Promise<void>,
        ) => Promise<T>,
      ): Promise<T> =>
        prisma.$transaction((tx: typeof transaction) =>
          operation(tx, async (items) => {
            await tx.notification.createMany({
              data: items,
              skipDuplicates: true,
            });
          }),
        ),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'OWNER',
    });
    transaction.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    transaction.projectMember.findFirst.mockResolvedValue({
      id: 'project-member-id',
      membership: { user: { name: 'Project User' } },
    });
    transaction.projectMember.findMany.mockResolvedValue([]);
    transaction.task.create.mockResolvedValue(taskRow);
    transaction.task.findMany.mockResolvedValue([taskRow]);
    transaction.task.findFirst.mockResolvedValue(taskDetails);
    transaction.task.updateMany.mockResolvedValue({ count: 1 });
    transaction.taskComment.create.mockResolvedValue({ id: 'comment-id' });
    transaction.taskComment.findMany.mockResolvedValue([]);
    transaction.taskActivity.create.mockResolvedValue({ id: 'activity-id' });
    transaction.auditLog.create.mockResolvedValue({ id: 'audit-log-id' });
    transaction.notification.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(TasksService);
  });

  it('creates a task and creation history in one transaction', async () => {
    await expect(
      service.create('organization-id', 'project-id', 'verified-user-id', {
        title: 'Prepare launch',
      }),
    ).resolves.toMatchObject({
      id: 'task-id',
      projectId: 'project-id',
      title: 'Prepare launch',
      status: 'TODO',
      priority: 'MEDIUM',
      creator: { id: 'verified-user-id', name: 'Jordan Wells' },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          projectId: 'project-id',
          creatorId: 'verified-user-id',
        }),
        select: expect.any(Object),
      }),
    );
    expect(transaction.taskActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-id',
        actorId: 'verified-user-id',
        type: 'CREATED',
      }),
      select: { id: true },
    });
    expect(transaction.taskActivity.create).toHaveBeenCalledTimes(1);
  });

  it('rolls back task creation if its history record cannot be written', async () => {
    const failure = new Error('Activity insert failed');
    transaction.taskActivity.create.mockRejectedValue(failure);

    await expect(
      service.create('organization-id', 'project-id', 'verified-user-id', {
        title: 'Prepare launch',
      }),
    ).rejects.toBe(failure);
    expect(transaction.task.create).toHaveBeenCalled();
    expect(transaction.taskActivity.create).toHaveBeenCalled();
  });

  it('lists tasks only within the authorized organization and project', async () => {
    await service.list('organization-id', 'project-id', 'verified-user-id');

    expect(transaction.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'organization-id', projectId: 'project-id' },
      }),
    );
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'allows organization %s to read tasks for an unassigned project without granting mutation capabilities',
    async (role) => {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      transaction.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        service.list('organization-id', 'project-id', 'verified-user-id'),
      ).resolves.toMatchObject([
        { id: 'task-id', canManage: false, canAssignOthers: false },
      ]);
      await expect(
        service.get(
          'organization-id',
          'project-id',
          'task-id',
          'verified-user-id',
        ),
      ).resolves.toMatchObject({
        id: 'task-id',
        canManage: false,
        canAssignOthers: false,
      });

      expect(transaction.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'organization-id', id: 'project-id' },
        }),
      );
    },
  );

  it('preserves task mutation capabilities for organization admins who are project members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'ADMIN',
    });

    await expect(
      service.get(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
      ),
    ).resolves.toMatchObject({ canManage: true, canAssignOthers: true });
  });

  it('hides tasks from users who are not active members of the project', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.projectMember.findFirst.mockResolvedValue(null);

    await expect(
      service.get(
        'another-organization',
        'another-project',
        'task-id',
        'verified-user-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.task.findFirst).not.toHaveBeenCalled();
  });

  it('denies organization admins access when the project is not in the requested organization', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'ADMIN',
    });
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.list(
        'another-organization',
        'another-project',
        'verified-user-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'another-organization',
          id: 'another-project',
        },
      }),
    );
    expect(transaction.task.findMany).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'does not grant organization %s task editing without project membership',
    async (role) => {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      transaction.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'organization-id',
          'project-id',
          'task-id',
          'verified-user-id',
          { title: 'Unauthorized edit' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transaction.task.updateMany).not.toHaveBeenCalled();
    },
  );

  it('scopes task lookup by organization, project, and task ID', async () => {
    transaction.task.findFirst.mockResolvedValue(null);

    await expect(
      service.get(
        'organization-id',
        'project-id',
        'task-from-another-project',
        'verified-user-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-from-another-project',
          organizationId: 'organization-id',
          projectId: 'project-id',
        },
      }),
    );
  });

  it('allows Managers to edit task details and records the change', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
    });

    await service.update(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
      { title: 'Updated launch task', priority: 'HIGH' },
    );

    expect(transaction.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task-id',
          organizationId: 'organization-id',
          projectId: 'project-id',
        }),
        data: { title: 'Updated launch task', priority: 'HIGH' },
      }),
    );
    expect(transaction.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'verified-user-id',
          type: 'UPDATED',
          message:
            'Updated title from "Prepare launch" to "Updated launch task"; priority from MEDIUM to HIGH.',
        }),
      }),
    );
  });

  it('prevents Members from editing task details', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      service.update(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
        { title: 'Unauthorized edit' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.task.updateMany).not.toHaveBeenCalled();
  });

  it('rejects removed or otherwise inactive project members as assignment targets', async () => {
    transaction.projectMember.findFirst
      .mockResolvedValueOnce({ id: 'current-member' })
      .mockResolvedValueOnce(null);

    await expect(
      service.assign(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
        { assigneeId: 'outside-user-id' },
      ),
    ).rejects.toThrow('Choose an active member of this project.');
    expect(transaction.task.updateMany).not.toHaveBeenCalled();
    expect(transaction.projectMember.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          organizationId: 'organization-id',
          projectId: 'project-id',
          userId: 'outside-user-id',
          status: 'ACTIVE',
          membership: {
            status: 'ACTIVE',
            organization: { status: 'ACTIVE' },
          },
        },
      }),
    );
  });

  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
    'allows %s to assign and unassign tasks',
    async (role) => {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      transaction.projectMember.findFirst
        .mockResolvedValueOnce({ id: 'current-member' })
        .mockResolvedValueOnce({
          membership: { user: { name: 'Assignee' } },
        });
      transaction.task.findFirst
        .mockResolvedValueOnce(taskRow)
        .mockResolvedValueOnce(taskDetails)
        .mockResolvedValueOnce({
          ...taskRow,
          assignee: {
            userId: 'eligible-user-id',
            membership: { user: { name: 'Assignee' } },
          },
        })
        .mockResolvedValueOnce(taskDetails);

      await service.assign(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
        { assigneeId: 'eligible-user-id' },
      );
      await service.assign(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
        { assigneeId: null },
      );

      expect(transaction.task.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: { assigneeId: 'eligible-user-id' } }),
      );
      expect(transaction.task.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { assigneeId: null } }),
      );
      expect(transaction.taskActivity.create).toHaveBeenCalledTimes(2);
      expect(transaction.taskActivity.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'verified-user-id',
            type: 'ASSIGNEE_CHANGED',
          }),
        }),
      );
      expect(transaction.auditLog.create).toHaveBeenCalledTimes(2);
      expect(transaction.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'organization-id',
            actorId: 'verified-user-id',
            action: 'TASK_ASSIGNED',
            targetId: 'task-id',
            before: { assigneeId: null },
            after: { assigneeId: 'eligible-user-id' },
          }),
        }),
      );
      expect(transaction.taskActivity.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'verified-user-id',
            type: 'ASSIGNEE_CHANGED',
          }),
        }),
      );
      expect(transaction.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              recipientId: 'eligible-user-id',
              type: 'TASK_ASSIGNED',
              resourceId: 'task-id',
            }),
          ],
          skipDuplicates: true,
        }),
      );
    },
  );

  it('denies Members assigning themselves, assigning others, and unassigning', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    for (const assigneeId of [
      'verified-user-id',
      'other-user-id',
      null,
    ] as const) {
      await expect(
        service.assign(
          'organization-id',
          'project-id',
          'task-id',
          'verified-user-id',
          { assigneeId },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(transaction.task.updateMany).not.toHaveBeenCalled();
    expect(transaction.projectMember.findFirst).toHaveBeenCalledTimes(3);
    expect(transaction.projectMember.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'other-user-id' }),
      }),
    );
  });

  it('lets project members change status and records blocker details', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await service.changeStatus(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
      { status: 'BLOCKED', blockerReason: 'Waiting for approval' },
    );

    expect(transaction.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'BLOCKED' } }),
    );
    expect(transaction.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'verified-user-id',
          type: 'STATUS_CHANGED',
          message: 'Marked this task as blocked: Waiting for approval',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          actorId: 'verified-user-id',
          action: 'TASK_STATUS_CHANGED',
          targetId: 'task-id',
          before: { status: 'TODO' },
          after: { status: 'BLOCKED' },
        }),
      }),
    );
  });

  it('notifies other involved project members when task status changes', async () => {
    transaction.task.findFirst.mockResolvedValueOnce({
      ...taskRow,
      creator: {
        userId: 'other-member-id',
        membership: { user: { name: 'Other Member' } },
      },
    });
    transaction.projectMember.findMany.mockResolvedValue([
      { userId: 'other-member-id' },
    ]);

    await service.changeStatus(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
      { status: 'IN_PROGRESS' },
    );

    expect(transaction.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recipientId: 'other-member-id',
            type: 'TASK_STATUS_CHANGED',
            resourceId: 'task-id',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('writes comments and comment activity atomically', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await service.addComment(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
      { body: 'I can take this.' },
    );

    expect(transaction.taskComment.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'organization-id',
        projectId: 'project-id',
        taskId: 'task-id',
        authorId: 'verified-user-id',
        body: 'I can take this.',
      },
    });
    expect(transaction.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'verified-user-id',
          type: 'COMMENT_ADDED',
        }),
      }),
    );
  });

  it('sends mention notifications to matching active project members', async () => {
    transaction.projectMember.findMany.mockResolvedValue([
      {
        userId: 'mentioned-member-id',
        membership: { user: { name: 'Casey Jones' } },
      },
    ]);

    await service.addComment(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
      { body: 'Thanks @Casey Jones, this is ready.' },
    );

    expect(transaction.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recipientId: 'mentioned-member-id',
            type: 'TASK_MENTION',
            resourceId: 'task-id',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('restricts archive and restore to Managers and higher roles', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      service.archive(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.task.updateMany).not.toHaveBeenCalled();
  });

  it('archives and restores without deleting tasks and records both events', async () => {
    const archivedTask = { ...taskDetails, archivedAt: new Date() };
    transaction.task.findFirst
      .mockResolvedValueOnce(taskRow)
      .mockResolvedValueOnce(archivedTask)
      .mockResolvedValueOnce(archivedTask)
      .mockResolvedValueOnce(taskDetails);

    await service.archive(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
    );
    await service.restore(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
    );

    expect(transaction.task.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { archivedAt: expect.any(Date) },
      }),
    );
    expect(transaction.task.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { archivedAt: null } }),
    );
    expect(transaction.taskActivity.create).toHaveBeenCalledTimes(2);
    expect(transaction.taskActivity.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'verified-user-id',
          type: 'ARCHIVED',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TASK_ARCHIVED',
          actorId: 'verified-user-id',
          before: { archived: false },
          after: { archived: true },
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TASK_RESTORED',
          actorId: 'verified-user-id',
          before: { archived: true },
          after: { archived: false },
        }),
      }),
    );
    expect(transaction.taskActivity.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'verified-user-id',
          type: 'RESTORED',
        }),
      }),
    );
    expect(transaction.task.delete).not.toHaveBeenCalled();
  });

  it.each([
    'CREATED',
    'UPDATED',
    'STATUS_CHANGED',
    'COMMENT_ADDED',
    'ASSIGNEE_CHANGED',
    'ARCHIVED',
    'RESTORED',
  ] as const)(
    'resolves the actual NEXUS user name for %s activity',
    async (type) => {
      transaction.task.findFirst.mockResolvedValue(detailsWithActivity(type));

      const result = await service.get(
        'organization-id',
        'project-id',
        'task-id',
        'verified-user-id',
      );

      expect(result.activity).toEqual([
        expect.objectContaining({
          actorId: 'verified-user-id',
          actorName: 'Jordan Wells',
          type,
        }),
      ]);
    },
  );

  it('resolves comment authors from NEXUS users and clearly labels unavailable accounts', async () => {
    transaction.task.findFirst.mockResolvedValue({
      ...detailsWithActivity('COMMENT_ADDED', ''),
      comments: [
        {
          id: 'comment-id',
          authorId: 'verified-user-id',
          body: 'A project update.',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          author: {
            membership: { user: { name: 'Jordan Wells' } },
          },
        },
        {
          id: 'legacy-comment-id',
          authorId: 'former-user-id',
          body: 'An older update.',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          author: {
            membership: { user: { name: '  ' } },
          },
        },
      ],
    });

    const result = await service.get(
      'organization-id',
      'project-id',
      'task-id',
      'verified-user-id',
    );

    expect(result.comments).toEqual([
      expect.objectContaining({
        authorId: 'former-user-id',
        authorName: 'Former project member (account unavailable)',
      }),
      expect.objectContaining({
        authorId: 'verified-user-id',
        authorName: 'Jordan Wells',
      }),
    ]);
    expect(result.activity[0]).toMatchObject({
      actorId: 'verified-user-id',
      actorName: 'Former project member (account unavailable)',
    });
  });

  it('does not allow task changes in archived projects', async () => {
    transaction.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });

    await expect(
      service.create('organization-id', 'project-id', 'verified-user-id', {
        title: 'New task',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.task.create).not.toHaveBeenCalled();
  });
});
