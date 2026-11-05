import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewNotification } from '../notifications/notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import { ProjectDiscussionsService } from './project-discussions.service.js';

const userId = '123e4567-e89b-42d3-a456-426614174000';
const organizationId = '123e4567-e89b-42d3-a456-426614174001';
const projectId = '123e4567-e89b-42d3-a456-426614174002';
const discussionId = '123e4567-e89b-42d3-a456-426614174003';
const messageId = '123e4567-e89b-42d3-a456-426614174004';
const otherUserId = '123e4567-e89b-42d3-a456-426614174005';
const createdAt = new Date('2026-11-04T10:00:00.000Z');

describe('ProjectDiscussionsService', () => {
  let service: ProjectDiscussionsService;
  const transaction = {
    organizationMembership: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    projectMember: { findMany: vi.fn() },
    projectDiscussion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    projectDiscussionMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    projectDiscussionRead: { findMany: vi.fn(), upsert: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  const publish = vi.fn(async (_notifications: NewNotification[]) => {});
  const notifications = {
    withTransaction: vi.fn(
      async <T>(
        operation: (
          tx: typeof transaction,
          send: (items: NewNotification[]) => Promise<void>,
        ) => Promise<T>,
      ): Promise<T> => operation(transaction, publish),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
      user: { name: 'Jordan Lee' },
    });
    transaction.project.findFirst.mockResolvedValue({
      name: 'Launch',
      status: 'ACTIVE',
    });
    transaction.projectMember.findMany.mockResolvedValue([
      { userId: otherUserId },
    ]);
    transaction.projectDiscussion.create.mockResolvedValue({
      id: discussionId,
      title: 'Release notes',
      createdAt,
      updatedAt: createdAt,
    });
    transaction.projectDiscussion.findMany.mockResolvedValue([]);
    transaction.projectDiscussion.findFirst.mockResolvedValue({
      id: discussionId,
      title: 'Release notes',
    });
    transaction.projectDiscussion.update.mockResolvedValue({});
    transaction.projectDiscussionMessage.create.mockResolvedValue({
      id: messageId,
      authorId: userId,
      body: 'Ready to ship?',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Jordan Lee' },
    });
    transaction.projectDiscussionMessage.findMany.mockResolvedValue([]);
    transaction.projectDiscussionMessage.findFirst.mockResolvedValue(null);
    transaction.projectDiscussionMessage.update.mockResolvedValue({
      id: messageId,
      authorId: userId,
      body: 'Updated message',
      createdAt,
      updatedAt: createdAt,
      editedAt: createdAt,
      deletedAt: null,
      author: { name: 'Jordan Lee' },
    });
    transaction.projectDiscussionRead.findMany.mockResolvedValue([]);
    transaction.projectDiscussionRead.upsert.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectDiscussionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(ProjectDiscussionsService);
  });

  it('creates a project-scoped discussion, first message, read state, and notifications atomically', async () => {
    await expect(
      service.create(organizationId, projectId, userId, {
        title: 'Release notes',
        body: 'Ready to ship?',
      }),
    ).resolves.toMatchObject({
      id: discussionId,
      title: 'Release notes',
      lastMessage: { body: 'Ready to ship?', authorName: 'Jordan Lee' },
      isUnread: false,
    });

    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId,
          id: projectId,
          members: { some: { userId, status: 'ACTIVE' } },
        }),
      }),
    );
    expect(transaction.projectDiscussion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { organizationId, projectId, createdById: userId, title: 'Release notes' },
      }),
    );
    expect(transaction.projectDiscussionMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId,
          projectId,
          discussionId,
          authorId: userId,
          body: 'Ready to ship?',
        },
      }),
    );
    expect(transaction.projectDiscussionRead.upsert).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith([
      expect.objectContaining({
        recipientId: otherUserId,
        organizationId,
        projectId,
        type: 'PROJECT_DISCUSSION_MESSAGE',
        resourceType: 'PROJECT',
        resourceId: projectId,
        eventKey: `project-discussion:${discussionId}:${messageId}:${otherUserId}`,
      }),
    ]);
  });

  it('allows Owners and Admins to discuss organization projects while requiring active organization membership', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'ADMIN',
      user: { name: 'Workspace Admin' },
    });
    await service.list(organizationId, projectId, userId);

    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId, id: projectId },
      }),
    );

    transaction.organizationMembership.findFirst.mockResolvedValue(null);
    await expect(
      service.list(organizationId, projectId, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a discussion from users who are not active members of the project', async () => {
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.list(organizationId, projectId, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.projectDiscussion.findMany).not.toHaveBeenCalled();
  });

  it('returns discussion read state and a stable cursor for another page', async () => {
    const older = {
      id: '123e4567-e89b-42d3-a456-426614174006',
      title: 'Earlier question',
      createdById: userId,
      createdAt,
      updatedAt: createdAt,
      creator: { name: 'Jordan Lee' },
      messages: [
        {
          id: messageId,
          authorId: userId,
          body: 'Anything to add?',
          createdAt,
          deletedAt: null,
          author: { name: 'Jordan Lee' },
        },
      ],
    };
    const newest = {
      ...older,
      id: discussionId,
      title: 'Current question',
      messages: [
        {
          ...older.messages[0],
          id: '123e4567-e89b-42d3-a456-426614174007',
        },
      ],
    };
    const additionalDiscussions = Array.from({ length: 19 }, (_, index) => ({
      ...older,
      id: `123e4567-e89b-42d3-a456-${String(index + 10).padStart(12, '0')}`,
    }));
    transaction.projectDiscussion.findMany.mockResolvedValue([
      newest,
      older,
      ...additionalDiscussions,
    ]);
    transaction.projectDiscussionRead.findMany.mockResolvedValue([
      {
        discussionId,
        lastReadAt: createdAt,
        lastReadMessageId: messageId,
      },
    ]);

    const page = await service.list(organizationId, projectId, userId);

    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toMatchObject({
      id: discussionId,
      isUnread: true,
      lastMessage: { authorName: 'Jordan Lee' },
    });
    expect(page.nextCursor).toBe(
      `${createdAt.toISOString()}|${additionalDiscussions[17]?.id}`,
    );
    expect(transaction.projectDiscussionRead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          discussionId: { in: expect.arrayContaining([discussionId, older.id]) },
        }),
      }),
    );
  });

  it('loads message history in chronological order and scopes the cursor to its discussion', async () => {
    const first = {
      id: messageId,
      authorId: userId,
      body: 'First',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Jordan Lee' },
    };
    const second = {
      ...first,
      id: '123e4567-e89b-42d3-a456-426614174007',
      body: 'Second',
      authorId: otherUserId,
      author: { name: 'Casey Kim' },
    };
    transaction.projectDiscussionMessage.findMany.mockResolvedValue([
      second,
      first,
    ]);

    await expect(
      service.listMessages(
        organizationId,
        projectId,
        discussionId,
        userId,
      ),
    ).resolves.toMatchObject({
      items: [{ body: 'First' }, { body: 'Second' }],
      hasMore: false,
      nextCursor: null,
    });
    expect(transaction.projectDiscussionMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId, projectId, discussionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('paginates to earlier messages with a deterministic timestamp and id cursor', async () => {
    const newest = {
      id: '123e4567-e89b-42d3-a456-426614174007',
      authorId: otherUserId,
      body: 'Second',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Casey Kim' },
    };
    const earlier = {
      ...newest,
      id: messageId,
      body: 'First',
      authorId: userId,
      author: { name: 'Jordan Lee' },
    };
    transaction.projectDiscussionMessage.findMany.mockResolvedValue([
      newest,
      earlier,
    ]);

    await expect(
      service.listMessages(
        organizationId,
        projectId,
        discussionId,
        userId,
        undefined,
        '1',
      ),
    ).resolves.toMatchObject({
      items: [{ id: newest.id, body: 'Second' }],
      hasMore: true,
      nextCursor: `${createdAt.toISOString()}|${newest.id}`,
    });
  });

  it('marks a discussion read through the newest persisted message', async () => {
    transaction.projectDiscussionMessage.findFirst.mockResolvedValue({
      id: messageId,
      createdAt,
    });

    await expect(
      service.markRead(organizationId, projectId, discussionId, userId),
    ).resolves.toEqual({ lastReadAt: createdAt, unread: false });
    expect(transaction.projectDiscussionRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          lastReadAt: createdAt,
          lastReadMessageId: messageId,
        }),
      }),
    );
  });

  it('allows only the author to edit messages', async () => {
    transaction.projectDiscussionMessage.findFirst.mockResolvedValue({
      id: messageId,
      authorId: otherUserId,
      body: 'Not yours',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Casey Kim' },
    });

    await expect(
      service.editMessage(
        organizationId,
        projectId,
        discussionId,
        messageId,
        userId,
        'Changed',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.projectDiscussionMessage.update).not.toHaveBeenCalled();
  });

  it('allows the message author to edit their own message', async () => {
    transaction.projectDiscussionMessage.findFirst.mockResolvedValue({
      id: messageId,
      authorId: userId,
      body: 'Original',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Jordan Lee' },
    });

    await expect(
      service.editMessage(
        organizationId,
        projectId,
        discussionId,
        messageId,
        userId,
        'Updated message',
      ),
    ).resolves.toMatchObject({
      body: 'Updated message',
      editedAt: expect.any(Date),
      canEdit: true,
    });
    expect(transaction.projectDiscussionMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { body: 'Updated message', editedAt: expect.any(Date) },
      }),
    );
  });

  it('allows project managers to remove a message while denying ordinary members', async () => {
    transaction.projectDiscussionMessage.findFirst.mockResolvedValue({
      id: messageId,
      authorId: otherUserId,
      body: 'Inappropriate',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: null,
      author: { name: 'Casey Kim' },
    });

    await expect(
      service.deleteMessage(
        organizationId,
        projectId,
        discussionId,
        messageId,
        userId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.projectDiscussionMessage.update).not.toHaveBeenCalled();

    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
      user: { name: 'Project Manager' },
    });
    transaction.projectDiscussionMessage.update.mockResolvedValueOnce({
      id: messageId,
      authorId: otherUserId,
      body: '',
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deletedAt: createdAt,
      author: { name: 'Casey Kim' },
    });
    await expect(
      service.deleteMessage(
        organizationId,
        projectId,
        discussionId,
        messageId,
        userId,
      ),
    ).resolves.toMatchObject({ deletedAt: expect.any(Date), canDelete: false });
    expect(transaction.projectDiscussionMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { body: '', deletedAt: expect.any(Date) },
      }),
    );
  });

  it('rejects new messages in archived projects', async () => {
    transaction.project.findFirst.mockResolvedValue({
      name: 'Launch',
      status: 'ARCHIVED',
    });

    await expect(
      service.addMessage(
        organizationId,
        projectId,
        discussionId,
        userId,
        'Another message',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.projectDiscussionMessage.create).not.toHaveBeenCalled();
  });

  it('validates message page sizes and malformed cursors', async () => {
    await expect(
      service.listMessages(
        organizationId,
        projectId,
        discussionId,
        userId,
        undefined,
        '100',
      ),
    ).rejects.toThrow('Message limit must be between 1 and 50.');
    await expect(
      service.list(organizationId, projectId, userId, 'not-a-cursor'),
    ).rejects.toThrow('The discussion cursor is invalid.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
