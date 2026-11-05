import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { ProjectStatus } from '../generated/prisma/client.js';
import type { NewNotification } from '../notifications/notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import type {
  CreateProjectDiscussionDto,
} from './project-discussions.dto.js';

type Transaction = Prisma.TransactionClient;

const DISCUSSION_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 30;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const discussionSelect = {
  id: true,
  title: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { name: true } },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      authorId: true,
      body: true,
      createdAt: true,
      deletedAt: true,
      author: { select: { name: true } },
    },
  },
} satisfies Prisma.ProjectDiscussionSelect;

const messageSelect = {
  id: true,
  authorId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  deletedAt: true,
  author: { select: { name: true } },
} satisfies Prisma.ProjectDiscussionMessageSelect;

type DiscussionRow = Prisma.ProjectDiscussionGetPayload<{
  select: typeof discussionSelect;
}>;
type MessageRow = Prisma.ProjectDiscussionMessageGetPayload<{
  select: typeof messageSelect;
}>;

interface DiscussionCursor {
  createdAt: Date;
  id: string;
}

interface ProjectAccess {
  projectStatus: ProjectStatus;
  userName: string;
  canManage: boolean;
}

export interface DiscussionMessageResponse {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ProjectDiscussionResponse {
  id: string;
  title: string;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessage: {
    id: string;
    authorName: string;
    body: string;
    createdAt: Date;
    deletedAt: Date | null;
  } | null;
  isUnread: boolean;
}

export interface ProjectDiscussionPage {
  items: ProjectDiscussionResponse[];
  nextCursor: string | null;
}

export interface DiscussionMessagePage {
  items: DiscussionMessageResponse[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ProjectDiscussionReadResponse {
  lastReadAt: Date | null;
  unread: false;
}

function parseCursor(value: string | undefined): DiscussionCursor | null {
  if (value === undefined) return null;
  const separator = value.lastIndexOf('|');
  if (separator <= 0) {
    throw new BadRequestException('The discussion cursor is invalid.');
  }
  const timestamp = value.slice(0, separator);
  const id = value.slice(separator + 1);
  const createdAt = new Date(timestamp);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== timestamp ||
    !uuidPattern.test(id)
  ) {
    throw new BadRequestException('The discussion cursor is invalid.');
  }
  return { createdAt, id };
}

function encodeCursor(value: DiscussionCursor): string {
  return `${value.createdAt.toISOString()}|${value.id}`;
}

function beforeCursor(cursor: DiscussionCursor): Prisma.ProjectDiscussionWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

function beforeMessageCursor(
  cursor: DiscussionCursor,
): Prisma.ProjectDiscussionMessageWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

@Injectable()
export class ProjectDiscussionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    organizationId: string,
    projectId: string,
    userId: string,
    before?: string,
  ): Promise<ProjectDiscussionPage> {
    const cursor = parseCursor(before);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      const discussions = await transaction.projectDiscussion.findMany({
        where: {
          organizationId,
          projectId,
          ...(cursor ? beforeCursor(cursor) : {}),
        },
        select: discussionSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: DISCUSSION_PAGE_SIZE + 1,
      });
      const hasMore = discussions.length > DISCUSSION_PAGE_SIZE;
      const page = discussions.slice(0, DISCUSSION_PAGE_SIZE);
      if (page.length === 0) return { items: [], nextCursor: null };

      const reads = await transaction.projectDiscussionRead.findMany({
        where: {
          organizationId,
          projectId,
          userId,
          discussionId: { in: page.map(({ id }) => id) },
        },
        select: {
          discussionId: true,
          lastReadAt: true,
          lastReadMessageId: true,
        },
      });
      const readsByDiscussion = new Map(
        reads.map((read) => [read.discussionId, read]),
      );
      const items = page.map((discussion) =>
        this.toDiscussionResponse(
          discussion,
          readsByDiscussion.get(discussion.id),
        ),
      );
      const last = page.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    });
  }

  async create(
    organizationId: string,
    projectId: string,
    userId: string,
    input: CreateProjectDiscussionDto,
  ): Promise<ProjectDiscussionResponse> {
    return this.notifications.withTransaction(
      async (transaction, publish) => {
        const access = await this.requireProjectAccess(
          transaction,
          organizationId,
          projectId,
          userId,
        );
        this.assertProjectIsActive(access);
        const discussion = await transaction.projectDiscussion.create({
          data: { organizationId, projectId, createdById: userId, title: input.title },
          select: { id: true, title: true, createdAt: true, updatedAt: true },
        });
        const message = await transaction.projectDiscussionMessage.create({
          data: {
            organizationId,
            projectId,
            discussionId: discussion.id,
            authorId: userId,
            body: input.body,
          },
          select: { id: true, createdAt: true },
        });
        await this.markCurrentUserRead(
          transaction,
          organizationId,
          projectId,
          discussion.id,
          userId,
          message,
        );
        await this.notifyDiscussionMembers(
          transaction,
          publish,
          organizationId,
          projectId,
          discussion.id,
          discussion.title,
          userId,
          message.id,
        );
        return {
          id: discussion.id,
          title: discussion.title,
          createdById: userId,
          createdByName: access.userName,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
          lastMessage: {
            id: message.id,
            authorName: access.userName,
            body: input.body,
            createdAt: message.createdAt,
            deletedAt: null,
          },
          isUnread: false,
        };
      },
    );
  }

  async listMessages(
    organizationId: string,
    projectId: string,
    discussionId: string,
    userId: string,
    before?: string,
    limit?: string,
  ): Promise<DiscussionMessagePage> {
    const cursor = parseCursor(before);
    const pageSize = this.readPageSize(limit);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      await this.requireDiscussion(
        transaction,
        organizationId,
        projectId,
        discussionId,
      );
      const rows = await transaction.projectDiscussionMessage.findMany({
        where: {
          organizationId,
          projectId,
          discussionId,
          ...(cursor ? beforeMessageCursor(cursor) : {}),
        },
        select: messageSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
      });
      const hasMore = rows.length > pageSize;
      const page = rows.slice(0, pageSize).reverse();
      const first = page[0];
      return {
        items: page.map((row) => this.toMessageResponse(row, userId, false)),
        hasMore,
        nextCursor:
          hasMore && first
            ? encodeCursor({ createdAt: first.createdAt, id: first.id })
            : null,
      };
    });
  }

  async addMessage(
    organizationId: string,
    projectId: string,
    discussionId: string,
    userId: string,
    body: string,
  ): Promise<DiscussionMessageResponse> {
    return this.notifications.withTransaction(
      async (transaction, publish) => {
        const access = await this.requireProjectAccess(
          transaction,
          organizationId,
          projectId,
          userId,
        );
        this.assertProjectIsActive(access);
        const discussion = await this.requireDiscussion(
          transaction,
          organizationId,
          projectId,
          discussionId,
        );
        const message = await transaction.projectDiscussionMessage.create({
          data: {
            organizationId,
            projectId,
            discussionId,
            authorId: userId,
            body,
          },
          select: messageSelect,
        });
        await transaction.projectDiscussion.update({
          where: {
            organizationId_projectId_id: {
              organizationId,
              projectId,
              id: discussionId,
            },
          },
          data: { updatedAt: new Date() },
        });
        await this.markCurrentUserRead(
          transaction,
          organizationId,
          projectId,
          discussionId,
          userId,
          message,
        );
        await this.notifyDiscussionMembers(
          transaction,
          publish,
          organizationId,
          projectId,
          discussionId,
          discussion.title,
          userId,
          message.id,
        );
        return this.toMessageResponse(message, userId, access.canManage);
      },
    );
  }

  async editMessage(
    organizationId: string,
    projectId: string,
    discussionId: string,
    messageId: string,
    userId: string,
    body: string,
  ): Promise<DiscussionMessageResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      const message = await this.requireMessage(
        transaction,
        organizationId,
        projectId,
        discussionId,
        messageId,
      );
      if (message.authorId !== userId) {
        throw new ForbiddenException('You can only edit your own messages.');
      }
      if (message.deletedAt) {
        throw new ConflictException('Deleted messages cannot be edited.');
      }
      const updated = await transaction.projectDiscussionMessage.update({
        where: {
          organizationId_projectId_discussionId_id: {
            organizationId,
            projectId,
            discussionId,
            id: messageId,
          },
        },
        data: { body, editedAt: new Date() },
        select: messageSelect,
      });
      return this.toMessageResponse(updated, userId, access.canManage);
    });
  }

  async deleteMessage(
    organizationId: string,
    projectId: string,
    discussionId: string,
    messageId: string,
    userId: string,
  ): Promise<DiscussionMessageResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      const message = await this.requireMessage(
        transaction,
        organizationId,
        projectId,
        discussionId,
        messageId,
      );
      if (message.authorId !== userId && !access.canManage) {
        throw new ForbiddenException(
          'Only the author or a project manager can delete this message.',
        );
      }
      if (message.deletedAt) {
        return this.toMessageResponse(message, userId, access.canManage);
      }
      const deleted = await transaction.projectDiscussionMessage.update({
        where: {
          organizationId_projectId_discussionId_id: {
            organizationId,
            projectId,
            discussionId,
            id: messageId,
          },
        },
        data: { body: '', deletedAt: new Date() },
        select: messageSelect,
      });
      return this.toMessageResponse(deleted, userId, access.canManage);
    });
  }

  async markRead(
    organizationId: string,
    projectId: string,
    discussionId: string,
    userId: string,
  ): Promise<ProjectDiscussionReadResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      await this.requireDiscussion(
        transaction,
        organizationId,
        projectId,
        discussionId,
      );
      const latest = await transaction.projectDiscussionMessage.findFirst({
        where: { organizationId, projectId, discussionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, createdAt: true },
      });
      if (latest) {
        await this.markCurrentUserRead(
          transaction,
          organizationId,
          projectId,
          discussionId,
          userId,
          latest,
        );
      }
      return { lastReadAt: latest?.createdAt ?? null, unread: false };
    });
  }

  private async requireProjectAccess(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectAccess> {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { role: true, user: { select: { name: true } } },
    });
    const project = await transaction.project.findFirst({
      where: {
        organizationId,
        id: projectId,
        ...(membership?.role === 'OWNER' || membership?.role === 'ADMIN'
          ? {}
          : { members: { some: { userId, status: 'ACTIVE' } } }),
      },
      select: { name: true, status: true },
    });
    if (!membership || !project) {
      throw new NotFoundException('Project not found.');
    }
    return {
      projectStatus: project.status,
      userName: membership.user.name,
      canManage:
        membership.role === 'OWNER' ||
        membership.role === 'ADMIN' ||
        membership.role === 'MANAGER',
    };
  }

  private async requireDiscussion(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    discussionId: string,
  ): Promise<{ id: string; title: string }> {
    const discussion = await transaction.projectDiscussion.findFirst({
      where: { id: discussionId, organizationId, projectId },
      select: { id: true, title: true },
    });
    if (!discussion) {
      throw new NotFoundException('Discussion not found.');
    }
    return discussion;
  }

  private async requireMessage(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    discussionId: string,
    messageId: string,
  ): Promise<MessageRow> {
    const message = await transaction.projectDiscussionMessage.findFirst({
      where: { id: messageId, discussionId, organizationId, projectId },
      select: messageSelect,
    });
    if (!message) {
      throw new NotFoundException('Message not found.');
    }
    return message;
  }

  private assertProjectIsActive(access: ProjectAccess): void {
    if (access.projectStatus === 'ARCHIVED') {
      throw new ConflictException(
        'Archived projects cannot change discussions.',
      );
    }
  }

  private readPageSize(value: string | undefined): number {
    if (value === undefined) return MESSAGE_PAGE_SIZE;
    if (!/^\d+$/u.test(value)) {
      throw new BadRequestException('Message limit must be between 1 and 50.');
    }
    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new BadRequestException('Message limit must be between 1 and 50.');
    }
    return pageSize;
  }

  private async markCurrentUserRead(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    discussionId: string,
    userId: string,
    message: { id: string; createdAt: Date },
  ): Promise<void> {
    await transaction.projectDiscussionRead.upsert({
      where: {
        organizationId_projectId_discussionId_userId: {
          organizationId,
          projectId,
          discussionId,
          userId,
        },
      },
      create: {
        organizationId,
        projectId,
        discussionId,
        userId,
        lastReadAt: message.createdAt,
        lastReadMessageId: message.id,
      },
      update: {
        lastReadAt: message.createdAt,
        lastReadMessageId: message.id,
      },
    });
  }

  private async notifyDiscussionMembers(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    organizationId: string,
    projectId: string,
    discussionId: string,
    title: string,
    actorId: string,
    messageId: string,
  ): Promise<void> {
    const recipients = await transaction.projectMember.findMany({
      where: {
        organizationId,
        projectId,
        userId: { not: actorId },
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    await publish(
      recipients.map(({ userId: recipientId }) => ({
        recipientId,
        organizationId,
        projectId,
        type: 'PROJECT_DISCUSSION_MESSAGE',
        title: `New message in ${title}`.slice(0, 200),
        message: 'A project member posted a message in this discussion.',
        resourceType: 'PROJECT',
        resourceId: projectId,
        eventKey: `project-discussion:${discussionId}:${messageId}:${recipientId}`,
      })),
    );
  }

  private toDiscussionResponse(
    row: DiscussionRow,
    read:
      | {
          lastReadAt: Date | null;
          lastReadMessageId: string | null;
        }
      | undefined,
  ): ProjectDiscussionResponse {
    const latest = row.messages[0];
    const isUnread =
      latest !== undefined &&
      (!read?.lastReadAt ||
        latest.createdAt > read.lastReadAt ||
        (latest.createdAt.getTime() === read.lastReadAt.getTime() &&
          latest.id > (read.lastReadMessageId ?? '')));
    return {
      id: row.id,
      title: row.title,
      createdById: row.createdById,
      createdByName: row.creator.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastMessage: latest
        ? {
            id: latest.id,
            authorName: latest.author.name,
            body: latest.deletedAt ? '' : latest.body,
            createdAt: latest.createdAt,
            deletedAt: latest.deletedAt,
          }
        : null,
      isUnread,
    };
  }

  private toMessageResponse(
    row: MessageRow,
    userId: string,
    canManage: boolean,
  ): DiscussionMessageResponse {
    return {
      id: row.id,
      authorId: row.authorId,
      authorName: row.author.name,
      body: row.deletedAt ? '' : row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      canEdit: row.authorId === userId && !row.deletedAt,
      canDelete: (row.authorId === userId || canManage) && !row.deletedAt,
    };
  }
}
