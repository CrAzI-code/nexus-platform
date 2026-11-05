import { Injectable, NotFoundException } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  NotificationResourceType,
  NotificationType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import {
  NotificationStreamService,
  type PersistedNotificationEvent,
} from './notification-stream.service.js';

type Transaction = Prisma.TransactionClient;
type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

export interface NewNotification {
  recipientId: string;
  organizationId: string;
  projectId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: NotificationResourceType;
  resourceId: string;
  eventKey: string;
}

export interface NotificationItem {
  id: string;
  organizationId: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: NotificationResourceType;
  resourceId: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const notificationSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  type: true,
  title: true,
  message: true,
  resourceType: true,
  resourceId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

const persistedNotificationSelect = {
  ...notificationSelect,
  recipientId: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

type PersistedNotificationRow = Prisma.NotificationGetPayload<{
  select: typeof persistedNotificationSelect;
}>;

interface AccessibleOrganizations {
  organizationIds: Set<string>;
  privilegedOrganizationIds: Set<string>;
  projectIds: Set<string>;
}

interface PendingInvitationReference {
  id: string;
  organizationId: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: NotificationStreamService,
  ) {}

  async withTransaction<T>(
    operation: (
      transaction: Transaction,
      publish: (notifications: NewNotification[]) => Promise<void>,
    ) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const pendingEvents: PersistedNotificationEvent[] = [];
    const result = await this.prisma.$transaction(
      async (transaction) =>
        operation(transaction, async (notifications) => {
          if (notifications.length === 0) return;
          const created = await transaction.notification.createManyAndReturn({
            data: notifications,
            skipDuplicates: true,
            select: persistedNotificationSelect,
          });
          pendingEvents.push(
            ...created.map((row: PersistedNotificationRow) => ({
              recipientId: row.recipientId,
              notification: this.toResponse(row),
            })),
          );
        }),
      options,
    );
    if (pendingEvents.length > 0) this.stream.publish(pendingEvents);
    return result;
  }

  async list(
    recipientId: string,
    recipientEmail: string,
    emailVerified: boolean,
    page: number,
    pageSize: number,
  ): Promise<NotificationPage> {
    const [accessible, invitationIds] = await Promise.all([
      this.getAccessibleOrganizations(recipientId),
      this.getPendingInvitations(recipientEmail, emailVerified),
    ]);
    await this.ensureInvitationNotifications(recipientId, invitationIds);
    const rows = await this.prisma.notification.findMany({
      where: this.visibleWhere(recipientId, accessible, invitationIds),
      select: notificationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);
    const items = pageRows
      .filter((row) => this.canView(row, accessible, invitationIds))
      .map((row) => this.toResponse(row));

    return { items, page, pageSize, hasMore };
  }

  async unreadCount(
    recipientId: string,
    recipientEmail: string,
    emailVerified: boolean,
  ): Promise<{ count: number }> {
    const [accessible, invitationIds] = await Promise.all([
      this.getAccessibleOrganizations(recipientId),
      this.getPendingInvitations(recipientEmail, emailVerified),
    ]);
    await this.ensureInvitationNotifications(recipientId, invitationIds);
    return {
      count: await this.prisma.notification.count({
        where: {
          ...this.visibleWhere(recipientId, accessible, invitationIds),
          readAt: null,
        },
      }),
    };
  }

  async listForStream(
    recipientId: string,
    recipientEmail: string,
    emailVerified: boolean,
    cursor: { createdAt: Date; id: string } | null,
    take = 100,
  ): Promise<NotificationItem[]> {
    const [accessible, invitationIds] = await Promise.all([
      this.getAccessibleOrganizations(recipientId),
      this.getPendingInvitations(recipientEmail, emailVerified),
    ]);
    const visibility = this.visibleWhere(
      recipientId,
      accessible,
      invitationIds,
    );
    const where: Prisma.NotificationWhereInput = cursor
      ? {
          AND: [
            visibility,
            {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            },
          ],
        }
      : visibility;
    const rows = await this.prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [
        { createdAt: cursor ? 'asc' : 'desc' },
        { id: cursor ? 'asc' : 'desc' },
      ],
      take,
    });
    const orderedRows = cursor ? rows : rows.reverse();
    return orderedRows
      .filter((row) => this.canView(row, accessible, invitationIds))
      .map((row) => this.toResponse(row));
  }

  streamFor(
    recipientId: string,
    recipientEmail: string,
    emailVerified: boolean,
    lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.stream.streamFor(
      recipientId,
      (cursor, take) =>
        this.listForStream(
          recipientId,
          recipientEmail,
          emailVerified,
          cursor,
          take,
        ),
      lastEventId,
    );
  }

  async markRead(
    notificationId: string,
    recipientId: string,
    recipientEmail: string,
    emailVerified: boolean,
  ): Promise<NotificationItem> {
    const [accessible, invitationIds] = await Promise.all([
      this.getAccessibleOrganizations(recipientId),
      this.getPendingInvitations(recipientEmail, emailVerified),
    ]);
    const where = this.visibleWhere(recipientId, accessible, invitationIds);
    const currentNotification = await this.prisma.notification.findFirst({
      where: { ...where, id: notificationId },
      select: notificationSelect,
    });
    if (!currentNotification) {
      throw new NotFoundException('Notification not found.');
    }
    await this.prisma.notification.updateMany({
      where: { ...where, id: notificationId, readAt: null },
      data: { readAt: new Date() },
    });
    const updatedNotification = await this.prisma.notification.findFirst({
      where: { ...where, id: notificationId },
      select: notificationSelect,
    });
    if (!updatedNotification) {
      throw new NotFoundException('Notification not found.');
    }
    return this.toResponse(updatedNotification);
  }

  async markAllRead(recipientId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async remove(
    notificationId: string,
    recipientId: string,
  ): Promise<{ deleted: true }> {
    const result = await this.prisma.notification.deleteMany({
      where: { id: notificationId, recipientId },
    });
    if (result.count !== 1)
      throw new NotFoundException('Notification not found.');
    return { deleted: true };
  }

  private async getAccessibleOrganizations(
    userId: string,
  ): Promise<AccessibleOrganizations> {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { organizationId: true, role: true },
    });
    const organizationIds = memberships.map(
      (membership) => membership.organizationId,
    );
    const privilegedOrganizationIds = memberships
      .filter(
        (membership) =>
          membership.role === 'OWNER' || membership.role === 'ADMIN',
      )
      .map((membership) => membership.organizationId);

    const projectMemberships =
      organizationIds.length === 0
        ? []
        : await this.prisma.projectMember.findMany({
            where: {
              userId,
              organizationId: { in: organizationIds },
              status: 'ACTIVE',
              membership: { status: 'ACTIVE' },
            },
            select: { projectId: true },
          });

    return {
      organizationIds: new Set(organizationIds),
      privilegedOrganizationIds: new Set(privilegedOrganizationIds),
      projectIds: new Set(projectMemberships.map((member) => member.projectId)),
    };
  }

  private async getPendingInvitations(
    email: string,
    emailVerified: boolean,
  ): Promise<PendingInvitationReference[]> {
    if (!emailVerified || !email.trim()) return [];
    const invitations = await this.prisma.invitation.findMany({
      where: {
        email: { equals: email.trim(), mode: 'insensitive' },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true },
    });
    return invitations;
  }

  private async ensureInvitationNotifications(
    recipientId: string,
    invitations: PendingInvitationReference[],
  ): Promise<void> {
    if (invitations.length === 0) return;
    await this.withTransaction(async (_transaction, publish) => {
      await publish(
        invitations.map((invitation) => ({
          recipientId,
          organizationId: invitation.organizationId,
          type: 'ORGANIZATION_INVITATION',
          title: 'Organization invitation',
          message: 'You have a pending invitation to join an organization.',
          resourceType: 'ORGANIZATION_INVITATION',
          resourceId: invitation.id,
          eventKey: `organization-invitation:${invitation.id}`,
        })),
      );
    });
  }

  private canView(
    notification: NotificationRow,
    accessible: AccessibleOrganizations,
    invitations: PendingInvitationReference[],
  ): boolean {
    if (notification.type === 'ORGANIZATION_INVITATION') {
      return invitations.some(
        (invitation) =>
          invitation.id === notification.resourceId &&
          invitation.organizationId === notification.organizationId,
      );
    }
    if (notification.type === 'TEAM_UPDATED') return true;
    if (!accessible.organizationIds.has(notification.organizationId)) {
      return false;
    }
    if (!notification.projectId) return true;
    if (notification.resourceType === 'TASK') {
      return accessible.projectIds.has(notification.projectId);
    }
    return (
      notification.resourceType === 'PROJECT' &&
      (accessible.privilegedOrganizationIds.has(notification.organizationId) ||
        accessible.projectIds.has(notification.projectId))
    );
  }

  private visibleWhere(
    recipientId: string,
    accessible: AccessibleOrganizations,
    invitations: PendingInvitationReference[],
  ): Prisma.NotificationWhereInput {
    const organizationIds = [...accessible.organizationIds];
    const projectIds = [...accessible.projectIds];
    const privilegedOrganizationIds = [...accessible.privilegedOrganizationIds];
    const visibleEvents: Prisma.NotificationWhereInput[] = [
      { type: 'TEAM_UPDATED' },
      ...(invitations.length > 0
        ? [
            {
              type: 'ORGANIZATION_INVITATION' as const,
              OR: invitations.map((invitation) => ({
                resourceId: invitation.id,
                organizationId: invitation.organizationId,
              })),
            },
          ]
        : []),
      ...(organizationIds.length > 0
        ? [
            {
              organizationId: { in: organizationIds },
              OR: [
                { projectId: null },
                ...(projectIds.length > 0
                  ? [{ projectId: { in: projectIds } }]
                  : []),
                ...(privilegedOrganizationIds.length > 0
                  ? [
                      {
                        organizationId: { in: privilegedOrganizationIds },
                        resourceType: 'PROJECT' as const,
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ];
    return { recipientId, OR: visibleEvents };
  }

  private toResponse(row: NotificationRow): NotificationItem {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      type: row.type,
      title: row.title,
      message: row.message,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
