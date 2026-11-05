import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service.js';
import { NotificationListPipe } from './notifications.dto.js';
import { NotificationStreamService } from './notification-stream.service.js';
import { NotificationsService } from './notifications.service.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const notificationRow = {
  id: 'notification-id',
  organizationId: 'organization-id',
  projectId: 'project-id',
  type: 'TASK_ASSIGNED',
  title: 'Task assigned to you',
  message: 'A task was assigned to you.',
  resourceType: 'TASK',
  resourceId: 'task-id',
  readAt: null,
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  const prisma = {
    $transaction: vi.fn(),
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
    organizationMembership: { findMany: vi.fn() },
    projectMember: { findMany: vi.fn() },
    invitation: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  };
  const stream = { publish: vi.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationStreamService, useValue: stream },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          notification: {
            createManyAndReturn: prisma.notification.createManyAndReturn,
          },
          task: { findMany: prisma.task.findMany },
        }),
    );
    prisma.notification.createManyAndReturn.mockResolvedValue([]);
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.findFirst.mockResolvedValue(notificationRow);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'organization-id', role: 'MEMBER' },
    ]);
    prisma.projectMember.findMany.mockResolvedValue([
      { projectId: 'project-id' },
    ]);
    prisma.invitation.findMany.mockResolvedValue([]);
    prisma.task.findMany.mockResolvedValue([]);
  });

  it('publishes newly persisted notifications only after the transaction commits', async () => {
    const order: string[] = [];
    prisma.notification.createManyAndReturn.mockResolvedValue([
      { ...notificationRow, recipientId: 'recipient-id' },
    ]);
    prisma.$transaction.mockImplementation(
      async (operation: (transaction: unknown) => Promise<unknown>) => {
        const result = await operation({
          notification: {
            createManyAndReturn: prisma.notification.createManyAndReturn,
          },
          task: { findMany: prisma.task.findMany },
        });
        order.push('committed');
        return result;
      },
    );
    stream.publish.mockImplementation(() => order.push('published'));

    await service.withTransaction(async (_transaction, publish) => {
      await publish([
        {
          recipientId: 'recipient-id',
          organizationId: 'organization-id',
          type: 'TASK_ASSIGNED',
          title: 'Task assigned',
          message: 'A task was assigned.',
          resourceType: 'TASK',
          resourceId: 'task-id',
          eventKey: 'assignment-event',
        },
      ]);
    });

    expect(order).toEqual(['committed', 'published']);
    expect(stream.publish).toHaveBeenCalledWith([
      expect.objectContaining({
        recipientId: 'recipient-id',
        notification: expect.objectContaining({ id: notificationRow.id }),
      }),
    ]);
  });

  it('does not publish notifications when the transaction rolls back', async () => {
    prisma.$transaction.mockImplementation(
      async (operation: (transaction: unknown) => Promise<unknown>) => {
        await operation({
          notification: {
            createManyAndReturn: prisma.notification.createManyAndReturn,
          },
          task: { findMany: prisma.task.findMany },
        });
        throw new Error('transaction failed');
      },
    );

    await expect(
      service.withTransaction(async (_transaction, publish) => {
        await publish([
          {
            recipientId: 'recipient-id',
            organizationId: 'organization-id',
            type: 'TASK_ASSIGNED',
            title: 'Task assigned',
            message: 'A task was assigned.',
            resourceType: 'TASK',
            resourceId: 'task-id',
            eventKey: 'assignment-event',
          },
        ]);
      }),
    ).rejects.toThrow('transaction failed');
    expect(stream.publish).not.toHaveBeenCalled();
  });

  it('lists only authenticated-recipient notifications visible to their project', async () => {
    prisma.notification.findMany.mockResolvedValue([notificationRow]);

    await expect(
      service.list('recipient-id', 'member@example.com', true, 1, 20),
    ).resolves.toMatchObject({
      items: [{ id: 'notification-id', resourceId: 'task-id' }],
      page: 1,
      pageSize: 20,
      hasMore: false,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientId: 'recipient-id',
          OR: expect.arrayContaining([
            expect.objectContaining({
              organizationId: { in: ['organization-id'] },
            }),
          ]),
        }),
        skip: 0,
        take: 21,
      }),
    );
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'recipient-id',
          organizationId: { in: ['organization-id'] },
        }),
      }),
    );
  });

  it('replays only currently visible persisted records after an SSE cursor', async () => {
    prisma.notification.findMany.mockResolvedValue([notificationRow]);

    await expect(
      service.listForStream('recipient-id', 'member@example.com', true, {
        createdAt: new Date('2026-11-01T23:59:00.000Z'),
        id: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).resolves.toMatchObject([{ id: 'notification-id' }]);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({ recipientId: 'recipient-id' }),
            {
              OR: [
                { createdAt: { gt: new Date('2026-11-01T23:59:00.000Z') } },
                {
                  createdAt: new Date('2026-11-01T23:59:00.000Z'),
                  id: { gt: '123e4567-e89b-42d3-a456-426614174000' },
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
    );
  });

  it('does not expose project notifications after organization membership ends', async () => {
    prisma.organizationMembership.findMany.mockResolvedValue([]);

    await service.list('recipient-id', 'member@example.com', true, 1, 20);

    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipientId: 'recipient-id',
          OR: [{ type: 'TEAM_UPDATED' }],
        },
      }),
    );
  });

  it('does not expose task alerts to Owners unless they are project members', async () => {
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'organization-id', role: 'OWNER' },
    ]);
    prisma.projectMember.findMany.mockResolvedValue([]);

    await service.list('recipient-id', 'owner@example.com', true, 1, 20);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipientId: 'recipient-id',
          OR: [
            { type: 'TEAM_UPDATED' },
            {
              organizationId: { in: ['organization-id'] },
              OR: [
                { projectId: null },
                {
                  organizationId: { in: ['organization-id'] },
                  resourceType: 'PROJECT',
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('only considers matching verified-email invitations visible', async () => {
    prisma.invitation.findMany.mockResolvedValue([
      { id: 'invitation-id', organizationId: 'organization-id' },
    ]);

    await service.list('recipient-id', 'member@example.com', true, 1, 20);

    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'member@example.com', mode: 'insensitive' },
          status: 'PENDING',
        }),
      }),
    );

    vi.clearAllMocks();
    prisma.organizationMembership.findMany.mockResolvedValue([]);
    prisma.projectMember.findMany.mockResolvedValue([]);
    prisma.invitation.findMany.mockResolvedValue([]);
    prisma.notification.findMany.mockResolvedValue([]);
    await service.list('recipient-id', 'member@example.com', false, 1, 20);
    expect(prisma.invitation.findMany).not.toHaveBeenCalled();
  });

  it('counts unread items using the same recipient and tenant visibility filters', async () => {
    prisma.invitation.findMany.mockResolvedValue([
      { id: 'invitation-id', organizationId: 'organization-id' },
    ]);
    prisma.notification.count.mockResolvedValue(3);

    await expect(
      service.unreadCount('recipient-id', 'member@example.com', true),
    ).resolves.toEqual({ count: 3 });
    expect(prisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientId: 'recipient-id',
          readAt: null,
          OR: expect.arrayContaining([
            { type: 'TEAM_UPDATED' },
            {
              type: 'ORGANIZATION_INVITATION',
              OR: [
                {
                  resourceId: 'invitation-id',
                  organizationId: 'organization-id',
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it('creates a persisted, deduplicated notification for an eligible pending invitation', async () => {
    prisma.invitation.findMany.mockResolvedValue([
      { id: 'invitation-id', organizationId: 'organization-id' },
    ]);

    await service.list('recipient-id', 'member@example.com', true, 1, 20);

    expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recipientId: 'recipient-id',
            organizationId: 'organization-id',
            type: 'ORGANIZATION_INVITATION',
            resourceId: 'invitation-id',
            eventKey: 'organization-invitation:invitation-id',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('marks a notification read only when it remains visible to its recipient', async () => {
    const readAt = new Date();
    prisma.notification.findFirst
      .mockResolvedValueOnce(notificationRow)
      .mockResolvedValueOnce({ ...notificationRow, readAt });
    await expect(
      service.markRead(
        'notification-id',
        'recipient-id',
        'member@example.com',
        true,
      ),
    ).resolves.toMatchObject({
      id: 'notification-id',
      readAt: expect.any(Date),
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'notification-id',
          recipientId: 'recipient-id',
          readAt: null,
        }),
      }),
    );

    prisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.markRead(
        'notification-id',
        'other-recipient',
        'other@example.com',
        true,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
  });

  it('deletes only the authenticated user’s notification', async () => {
    await expect(
      service.remove('notification-id', 'recipient-id'),
    ).resolves.toEqual({ deleted: true });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'notification-id', recipientId: 'recipient-id' },
    });

    prisma.notification.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.remove('notification-id', 'other-recipient'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('NotificationListPipe', () => {
  const pipe = new NotificationListPipe();

  it('defaults pagination and accepts bounded positive integers', () => {
    expect(pipe.transform({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
    expect(pipe.transform({})).toEqual({ page: 1, pageSize: 20 });
  });

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { page: '1.2' },
    { other: 'x' },
  ])('rejects invalid pagination input', (query) => {
    expect(() => pipe.transform(query)).toThrow();
  });
});
