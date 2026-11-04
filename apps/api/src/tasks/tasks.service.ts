import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  OrganizationRole,
  TaskActivityType,
  TaskPriority,
  TaskStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import {
  NotificationsService,
  type NewNotification,
} from '../notifications/notifications.service.js';
import type {
  AssignTaskDto,
  ChangeTaskStatusDto,
  CreateTaskCommentDto,
  CreateTaskDto,
  UpdateTaskDto,
} from './task.dto.js';

const taskSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { name: true, status: true } },
  creator: {
    select: {
      userId: true,
      membership: { select: { user: { select: { name: true } } } },
    },
  },
  assignee: {
    select: {
      userId: true,
      membership: { select: { user: { select: { name: true } } } },
    },
  },
  _count: { select: { comments: true } },
  blockers: {
    where: { resolvedAt: null },
    select: {
      id: true,
      reason: true,
      createdById: true,
      createdAt: true,
      resolvedAt: true,
      creator: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.TaskSelect;

const taskDetailsSelect = {
  ...taskSelect,
  comments: {
    select: {
      id: true,
      authorId: true,
      body: true,
      createdAt: true,
      author: {
        select: {
          membership: { select: { user: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
  activities: {
    select: {
      id: true,
      actorId: true,
      type: true,
      message: true,
      createdAt: true,
      actor: {
        select: {
          membership: { select: { user: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
  blockers: {
    select: {
      id: true,
      reason: true,
      createdById: true,
      createdAt: true,
      resolvedById: true,
      resolvedAt: true,
      creator: { select: { name: true } },
      resolver: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
type TaskDetailsRow = Prisma.TaskGetPayload<{
  select: typeof taskDetailsSelect;
}>;
type Transaction = Prisma.TransactionClient;

type ProjectAccess = {
  role: OrganizationRole;
  projectStatus: 'ACTIVE' | 'ARCHIVED';
  isProjectMember: boolean;
};

function displayAttributionName(name: string | null | undefined): string {
  const normalizedName = name?.trim();
  return normalizedName || 'Former project member (account unavailable)';
}

export interface TaskSummaryResponse {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: 'ACTIVE' | 'ARCHIVED';
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  commentCount: number;
  canManage: boolean;
  canAssignOthers: boolean;
  activeBlocker: TaskBlockerSummaryResponse | null;
}

export interface TaskBlockerSummaryResponse {
  id: string;
  reason: string;
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

export interface TaskBlockerHistoryResponse extends TaskBlockerSummaryResponse {
  resolvedById: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
}

export interface TaskCommentResponse {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface TaskActivityResponse {
  id: string;
  actorId: string;
  actorName: string;
  type: TaskActivityType;
  message: string;
  createdAt: Date;
}

export interface TaskDetailsResponse extends TaskSummaryResponse {
  canParticipate: boolean;
  comments: TaskCommentResponse[];
  activity: TaskActivityResponse[];
  blockerHistory: TaskBlockerHistoryResponse[];
}

export interface TaskProjectMemberResponse {
  id: string;
  name: string;
  isCurrentUser: boolean;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    organizationId: string,
    projectId: string,
    userId: string,
    input: CreateTaskDto,
  ): Promise<TaskSummaryResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);

      const task = await transaction.task.create({
        data: {
          organizationId,
          projectId,
          creatorId: userId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? 'MEDIUM',
          dueAt: this.toDueAt(input.dueAt),
        },
        select: taskSelect,
      });
      await this.recordActivity(
        transaction,
        organizationId,
        projectId,
        task.id,
        userId,
        'CREATED',
        `Created task "${input.title}".`,
      );

      return this.toSummary(task, access.role);
    });
  }

  async list(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<TaskSummaryResponse[]> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.findProjectReadAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      const tasks = await transaction.task.findMany({
        where: { organizationId, projectId },
        select: taskSelect,
        orderBy: [{ archivedAt: 'asc' }, { updatedAt: 'desc' }],
      });
      return tasks.map((task) =>
        this.toSummary(task, access.role, access.isProjectMember),
      );
    });
  }

  async get(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
  ): Promise<TaskDetailsResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.findProjectReadAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      const task = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(task, access.role, access.isProjectMember);
    });
  }

  async listMembers(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<{
    members: TaskProjectMemberResponse[];
    canAssignOthers: boolean;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.findProjectReadAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      const members = await transaction.projectMember.findMany({
        where: {
          organizationId,
          projectId,
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
        },
        select: {
          userId: true,
          membership: { select: { user: { select: { name: true } } } },
        },
      });
      return {
        members: members
          .map((member) => ({
            id: member.userId,
            name: member.membership.user.name,
            isCurrentUser: member.userId === userId,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        canAssignOthers: access.isProjectMember && this.canManage(access.role),
      };
    });
  }

  async update(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: UpdateTaskDto,
  ): Promise<TaskDetailsResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      this.assertCanManage(access.role);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      this.assertTaskIsActive(task);

      const changes: string[] = [];
      const before: {
        title?: string;
        priority?: string;
        dueAt?: string | null;
        descriptionChanged?: boolean;
      } = {};
      const after: {
        title?: string;
        priority?: string;
        dueAt?: string | null;
        descriptionChanged?: boolean;
      } = {};
      const data: Prisma.TaskUpdateManyMutationInput = {};
      let updatedDueAt: Date | null | undefined;
      if (input.title !== undefined && input.title !== task.title) {
        data.title = input.title;
        changes.push(`title from "${task.title}" to "${input.title}"`);
        before.title = task.title;
        after.title = input.title;
      }
      if (
        input.description !== undefined &&
        input.description !== task.description
      ) {
        data.description = input.description;
        changes.push('description');
        before.descriptionChanged = true;
        after.descriptionChanged = true;
      }
      if (input.priority !== undefined && input.priority !== task.priority) {
        data.priority = input.priority;
        changes.push(`priority from ${task.priority} to ${input.priority}`);
        before.priority = task.priority;
        after.priority = input.priority;
      }
      if (input.dueAt !== undefined) {
        const dueAt = this.toDueAt(input.dueAt);
        if (dueAt?.getTime() !== task.dueAt?.getTime()) {
          data.dueAt = dueAt;
          updatedDueAt = dueAt;
          changes.push(
            `due date from ${task.dueAt?.toISOString().slice(0, 10) ?? 'none'} to ${dueAt?.toISOString().slice(0, 10) ?? 'none'}`,
          );
          before.dueAt = task.dueAt?.toISOString() ?? null;
          after.dueAt = dueAt?.toISOString() ?? null;
        }
      }

      if (changes.length > 0) {
        const result = await transaction.task.updateMany({
          where: {
            id: taskId,
            organizationId,
            projectId,
            archivedAt: null,
            ...(data.title !== undefined ? { title: task.title } : {}),
            ...(data.description !== undefined
              ? { description: task.description }
              : {}),
            ...(data.priority !== undefined ? { priority: task.priority } : {}),
            ...(data.dueAt !== undefined ? { dueAt: task.dueAt } : {}),
          },
          data,
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'This task changed. Reload and try again.',
          );
        }
        await this.recordActivity(
          transaction,
          organizationId,
          projectId,
          taskId,
          userId,
          'UPDATED',
          `Updated ${changes.join('; ')}.`,
        );
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: userId,
          action: 'TASK_UPDATED',
          targetType: 'TASK',
          targetId: taskId,
          before,
          after,
        });
        if (updatedDueAt && task.status !== 'DONE') {
          await this.notifyDueDateParticipants(
            publish,
            task,
            userId,
            updatedDueAt,
          );
        }
      }

      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  async assign(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: AssignTaskDto,
  ): Promise<TaskDetailsResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      this.assertCanManage(access.role);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      this.assertTaskIsActive(task);

      let assigneeName: string | null = null;
      if (input.assigneeId) {
        const assignee = await transaction.projectMember.findFirst({
          where: {
            organizationId,
            projectId,
            userId: input.assigneeId,
            status: 'ACTIVE',
            membership: {
              status: 'ACTIVE',
              organization: { status: 'ACTIVE' },
            },
          },
          select: {
            membership: { select: { user: { select: { name: true } } } },
          },
        });
        if (!assignee) {
          throw new BadRequestException(
            'Choose an active member of this project.',
          );
        }
        assigneeName = assignee.membership.user.name;
      }

      if (task.assignee?.userId !== input.assigneeId) {
        const result = await transaction.task.updateMany({
          where: {
            id: taskId,
            organizationId,
            projectId,
            archivedAt: null,
            assigneeId: task.assignee?.userId ?? null,
          },
          data: { assigneeId: input.assigneeId },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'This task changed. Reload and try again.',
          );
        }
        const previousAssignee = task.assignee?.membership.user.name;
        const assignmentMessage = assigneeName
          ? previousAssignee
            ? `Reassigned this task from ${previousAssignee} to ${assigneeName}.`
            : `Assigned this task to ${assigneeName}.`
          : previousAssignee
            ? `Unassigned this task from ${previousAssignee}.`
            : 'Removed the task assignee.';
        const activityId = await this.recordActivity(
          transaction,
          organizationId,
          projectId,
          taskId,
          userId,
          'ASSIGNEE_CHANGED',
          assignmentMessage,
        );
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: userId,
          action: 'TASK_ASSIGNED',
          targetType: 'TASK',
          targetId: taskId,
          before: { assigneeId: task.assignee?.userId ?? null },
          after: { assigneeId: input.assigneeId ?? null },
        });
        if (input.assigneeId && input.assigneeId !== userId) {
          await publish([
            {
              recipientId: input.assigneeId,
              organizationId,
              projectId,
              type: 'TASK_ASSIGNED',
              title: 'Task assigned to you',
              message: 'A task has been assigned to you.',
              resourceType: 'TASK',
              resourceId: taskId,
              eventKey: `task-assigned:${activityId}`,
            },
          ]);
        }
      }

      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  async changeStatus(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: ChangeTaskStatusDto,
  ): Promise<TaskDetailsResponse> {
    if (input.status === 'BLOCKED') {
      if (!input.blockerReason) {
        throw new BadRequestException(
          'Provide a blocker reason when setting a task to blocked.',
        );
      }
      return this.createBlocker(organizationId, projectId, taskId, userId, {
        reason: input.blockerReason,
      });
    }

    return this.notifications.withTransaction(async (transaction, publish) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      this.assertTaskIsActive(task);

      const activeBlocker = await transaction.taskBlocker.findFirst({
        where: {
          organizationId,
          projectId,
          taskId,
          resolvedAt: null,
        },
        select: {
          id: true,
          reason: true,
          priorStatus: true,
          createdById: true,
          createdAt: true,
        },
      });
      if (activeBlocker) {
        await this.resolveBlockerInTransaction(
          transaction,
          publish,
          organizationId,
          projectId,
          taskId,
          activeBlocker.id,
          userId,
          input.status,
          task,
        );
        const updated = await this.findTaskDetails(
          transaction,
          organizationId,
          projectId,
          taskId,
        );
        return this.toDetails(updated, access.role);
      }

      if (input.status !== task.status) {
        const result = await transaction.task.updateMany({
          where: {
            id: taskId,
            organizationId,
            projectId,
            archivedAt: null,
            status: task.status,
          },
          data: { status: input.status },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'This task changed. Reload and try again.',
          );
        }
      }

      if (input.status !== task.status || input.blockerReason) {
        const message =
          input.status === 'BLOCKED'
            ? `Marked this task as blocked: ${input.blockerReason}`
            : `Changed status from ${task.status} to ${input.status}.`;
        const activityId = await this.recordActivity(
          transaction,
          organizationId,
          projectId,
          taskId,
          userId,
          'STATUS_CHANGED',
          message,
        );
        if (input.status !== task.status) {
          await AuditLogsService.record(transaction, {
            organizationId,
            actorId: userId,
            action: 'TASK_STATUS_CHANGED',
            targetType: 'TASK',
            targetId: taskId,
            before: { status: task.status },
            after: { status: input.status },
          });
        }
        await this.notifyTaskParticipants(
          transaction,
          publish,
          task,
          userId,
          activityId,
          'TASK_STATUS_CHANGED',
          `Task status changed to ${input.status}.`,
        );
      }

      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  async createBlocker(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: { reason: string },
  ): Promise<TaskDetailsResponse> {
    try {
      return await this.notifications.withTransaction(
        async (transaction, publish) => {
          const access = await this.requireProjectMemberAccess(
            transaction,
            organizationId,
            projectId,
            userId,
          );
          this.assertProjectIsActive(access);
          const task = await this.findTask(
            transaction,
            organizationId,
            projectId,
            taskId,
          );
          this.assertTaskIsActive(task);

          const existing = await transaction.taskBlocker.findFirst({
            where: {
              organizationId,
              projectId,
              taskId,
              resolvedAt: null,
            },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException(
              'This task already has an active blocker.',
            );
          }

          const priorStatus =
            task.status === 'BLOCKED' ? 'IN_PROGRESS' : task.status;
          const blocker = await transaction.taskBlocker.create({
            data: {
              organizationId,
              projectId,
              taskId,
              reason: input.reason,
              priorStatus,
              createdById: userId,
            },
            select: { id: true },
          });
          if (task.status !== 'BLOCKED') {
            const updatedTask = await transaction.task.updateMany({
              where: {
                id: taskId,
                organizationId,
                projectId,
                archivedAt: null,
                status: task.status,
              },
              data: { status: 'BLOCKED' },
            });
            if (updatedTask.count !== 1) {
              throw new ConflictException(
                'This task changed. Reload and try again.',
              );
            }
            await AuditLogsService.record(transaction, {
              organizationId,
              actorId: userId,
              action: 'TASK_STATUS_CHANGED',
              targetType: 'TASK',
              targetId: taskId,
              before: { status: task.status },
              after: { status: 'BLOCKED' },
            });
          }

          await this.recordActivity(
            transaction,
            organizationId,
            projectId,
            taskId,
            userId,
            'BLOCKER_CREATED',
            `Marked this task as blocked: ${input.reason}`,
          );
          await AuditLogsService.record(transaction, {
            organizationId,
            actorId: userId,
            action: 'TASK_BLOCKED',
            targetType: 'TASK',
            targetId: taskId,
            before: { activeBlockerId: null },
            after: {
              blockerId: blocker.id,
              reason: input.reason,
              status: 'BLOCKED',
            },
          });
          await this.notifyBlockerParticipants(
            transaction,
            publish,
            task,
            userId,
            blocker.id,
            false,
          );

          const updated = await this.findTaskDetails(
            transaction,
            organizationId,
            projectId,
            taskId,
          );
          return this.toDetails(updated, access.role);
        },
      );
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException('This task already has an active blocker.');
      }
      throw error;
    }
  }

  async resolveBlocker(
    organizationId: string,
    projectId: string,
    taskId: string,
    blockerId: string,
    userId: string,
  ): Promise<TaskDetailsResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      this.assertTaskIsActive(task);
      await this.resolveBlockerInTransaction(
        transaction,
        publish,
        organizationId,
        projectId,
        taskId,
        blockerId,
        userId,
        undefined,
        task,
      );
      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  async addComment(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    input: CreateTaskCommentDto,
  ): Promise<TaskDetailsResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      this.assertTaskIsActive(task);

      const comment = await transaction.taskComment.create({
        data: {
          organizationId,
          projectId,
          taskId,
          authorId: userId,
          body: input.body,
        },
      });
      await this.recordActivity(
        transaction,
        organizationId,
        projectId,
        taskId,
        userId,
        'COMMENT_ADDED',
        'Added a comment.',
      );
      await this.notifyTaskParticipants(
        transaction,
        publish,
        task,
        userId,
        comment.id,
        'TASK_COMMENT',
        'A project member commented on a task.',
        input.body,
      );

      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  async archive(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
  ): Promise<TaskDetailsResponse> {
    return this.setArchived(organizationId, projectId, taskId, userId, true);
  }

  async restore(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
  ): Promise<TaskDetailsResponse> {
    return this.setArchived(organizationId, projectId, taskId, userId, false);
  }

  private async setArchived(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    archived: boolean,
  ): Promise<TaskDetailsResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectMemberAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectIsActive(access);
      this.assertCanManage(access.role);
      const task = await this.findTask(
        transaction,
        organizationId,
        projectId,
        taskId,
      );

      if (Boolean(task.archivedAt) !== archived) {
        const result = await transaction.task.updateMany({
          where: {
            id: taskId,
            organizationId,
            projectId,
            archivedAt: archived ? null : { not: null },
          },
          data: { archivedAt: archived ? new Date() : null },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'This task changed. Reload and try again.',
          );
        }
        await this.recordActivity(
          transaction,
          organizationId,
          projectId,
          taskId,
          userId,
          archived ? 'ARCHIVED' : 'RESTORED',
          archived ? 'Archived this task.' : 'Restored this task.',
        );
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: userId,
          action: archived ? 'TASK_ARCHIVED' : 'TASK_RESTORED',
          targetType: 'TASK',
          targetId: taskId,
          before: { archived: !archived },
          after: { archived },
        });
      }

      const updated = await this.findTaskDetails(
        transaction,
        organizationId,
        projectId,
        taskId,
      );
      return this.toDetails(updated, access.role);
    });
  }

  private async requireProjectMemberAccess(
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
      select: { role: true },
    });
    const project = await transaction.project.findFirst({
      where: { organizationId, id: projectId },
      select: { status: true },
    });
    const projectMember = await transaction.projectMember.findFirst({
      where: {
        organizationId,
        projectId,
        userId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!membership || !project || !projectMember) {
      throw new NotFoundException('Project not found.');
    }

    return {
      role: membership.role,
      projectStatus: project.status,
      isProjectMember: true,
    };
  }

  private async findProjectReadAccess(
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
      select: { role: true },
    });
    const project = await transaction.project.findFirst({
      where: { organizationId, id: projectId },
      select: { status: true },
    });
    if (!membership || !project) {
      throw new NotFoundException('Project not found.');
    }

    const projectMember = await transaction.projectMember.findFirst({
      where: {
        organizationId,
        projectId,
        userId,
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    const hasOrganizationReadAccess =
      membership.role === 'OWNER' || membership.role === 'ADMIN';
    if (!projectMember && !hasOrganizationReadAccess) {
      throw new NotFoundException('Project not found.');
    }

    return {
      role: membership.role,
      projectStatus: project.status,
      isProjectMember: Boolean(projectMember),
    };
  }

  private async findTask(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskRow> {
    const task = await transaction.task.findFirst({
      where: { id: taskId, organizationId, projectId },
      select: taskSelect,
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async findTaskDetails(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskDetailsRow> {
    const task = await transaction.task.findFirst({
      where: { id: taskId, organizationId, projectId },
      select: taskDetailsSelect,
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async recordActivity(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    taskId: string,
    actorId: string,
    type: TaskActivityType,
    message: string,
  ): Promise<string> {
    const activity = await transaction.taskActivity.create({
      data: { organizationId, projectId, taskId, actorId, type, message },
      select: { id: true },
    });
    return activity.id;
  }

  private async resolveBlockerInTransaction(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    organizationId: string,
    projectId: string,
    taskId: string,
    blockerId: string,
    actorId: string,
    requestedStatus: TaskStatus | undefined,
    task: TaskRow,
  ): Promise<void> {
    const blocker = await transaction.taskBlocker.findFirst({
      where: {
        id: blockerId,
        organizationId,
        projectId,
        taskId,
        resolvedAt: null,
      },
      select: {
        id: true,
        reason: true,
        priorStatus: true,
      },
    });
    if (!blocker) throw new NotFoundException('Active task blocker not found.');
    if (task.status !== 'BLOCKED') {
      throw new ConflictException(
        'The task status no longer matches its active blocker.',
      );
    }

    const resolvedAt = new Date();
    const blockerUpdate = await transaction.taskBlocker.updateMany({
      where: {
        id: blockerId,
        organizationId,
        projectId,
        taskId,
        resolvedAt: null,
      },
      data: { resolvedById: actorId, resolvedAt },
    });
    if (blockerUpdate.count !== 1) {
      throw new ConflictException(
        'This blocker was already resolved. Reload and try again.',
      );
    }

    const nextStatus =
      requestedStatus ??
      (blocker.priorStatus === 'BLOCKED' ? 'IN_PROGRESS' : blocker.priorStatus);
    const taskUpdate = await transaction.task.updateMany({
      where: {
        id: taskId,
        organizationId,
        projectId,
        archivedAt: null,
        status: 'BLOCKED',
      },
      data: { status: nextStatus },
    });
    if (taskUpdate.count !== 1) {
      throw new ConflictException('This task changed. Reload and try again.');
    }

    await this.recordActivity(
      transaction,
      organizationId,
      projectId,
      taskId,
      actorId,
      'BLOCKER_RESOLVED',
      `Resolved blocker: ${blocker.reason}`,
    );
    await AuditLogsService.record(transaction, {
      organizationId,
      actorId,
      action: 'TASK_UNBLOCKED',
      targetType: 'TASK',
      targetId: taskId,
      before: { blockerId, reason: blocker.reason, status: 'BLOCKED' },
      after: { resolved: true, status: nextStatus },
    });
    await this.notifyBlockerParticipants(
      transaction,
      publish,
      task,
      actorId,
      blockerId,
      true,
    );
  }

  private async notifyBlockerParticipants(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    task: TaskRow,
    actorId: string,
    blockerId: string,
    resolved: boolean,
  ): Promise<void> {
    const members = await transaction.projectMember.findMany({
      where: {
        organizationId: task.organizationId,
        projectId: task.projectId,
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    const type = resolved ? 'TASK_UNBLOCKED' : 'TASK_BLOCKED';
    await publish(
      members
        .filter((member) => member.userId !== actorId)
        .map((member) => ({
          recipientId: member.userId,
          organizationId: task.organizationId,
          projectId: task.projectId,
          type,
          title: resolved ? 'Task blocker resolved' : 'Task is blocked',
          message: resolved
            ? 'A task blocker was resolved.'
            : 'A task was blocked.',
          resourceType: 'TASK',
          resourceId: task.id,
          eventKey: `task-blocker:${blockerId}:${resolved ? 'resolved' : 'created'}:${member.userId}`,
        })),
    );
  }

  private async notifyDueDateParticipants(
    publish: (notifications: NewNotification[]) => Promise<void>,
    task: TaskRow,
    actorId: string,
    dueAt: Date,
  ): Promise<void> {
    const recipientIds = new Set([
      task.creator.userId,
      ...(task.assignee ? [task.assignee.userId] : []),
    ]);
    recipientIds.delete(actorId);
    if (recipientIds.size === 0) return;

    const dueDate = dueAt.toISOString().slice(0, 10);
    await publish(
      [...recipientIds].map((recipientId) => ({
        recipientId,
        organizationId: task.organizationId,
        projectId: task.projectId,
        type: 'TASK_DUE_DATE',
        title: 'Task due date updated',
        message: `A task you follow is due on ${dueDate}.`,
        resourceType: 'TASK',
        resourceId: task.id,
        eventKey: `task-due-date:${task.id}:${dueAt.toISOString()}:${recipientId}`,
      })),
    );
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async notifyTaskParticipants(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    task: TaskRow,
    actorId: string,
    eventId: string,
    defaultType: 'TASK_COMMENT' | 'TASK_STATUS_CHANGED',
    defaultMessage: string,
    commentBody?: string,
  ): Promise<void> {
    const members = await transaction.projectMember.findMany({
      where: {
        organizationId: task.organizationId,
        projectId: task.projectId,
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
      },
      select: {
        userId: true,
        membership: { select: { user: { select: { name: true } } } },
      },
    });
    const activeMemberIds = new Set(members.map((member) => member.userId));
    const involvedUserIds = new Set<string>([
      task.creator.userId,
      ...(task.assignee ? [task.assignee.userId] : []),
    ]);

    if (defaultType === 'TASK_COMMENT') {
      const commenters = await transaction.taskComment.findMany({
        where: {
          organizationId: task.organizationId,
          projectId: task.projectId,
          taskId: task.id,
        },
        select: { authorId: true },
        distinct: ['authorId'],
      });
      for (const commenter of commenters)
        involvedUserIds.add(commenter.authorId);
    }

    const mentionedUserIds = new Set<string>();
    if (commentBody) {
      for (const member of members) {
        if (
          this.commentMentionsName(commentBody, member.membership.user.name)
        ) {
          mentionedUserIds.add(member.userId);
        }
      }
    }

    const recipientIds = new Set([
      ...[...involvedUserIds].filter((id) => activeMemberIds.has(id)),
      ...mentionedUserIds,
    ]);
    recipientIds.delete(actorId);
    await publish(
      [...recipientIds].map((recipientId) => {
        const isMention = mentionedUserIds.has(recipientId);
        return {
          recipientId,
          organizationId: task.organizationId,
          projectId: task.projectId,
          type: isMention ? 'TASK_MENTION' : defaultType,
          title: isMention
            ? 'You were mentioned in a task comment'
            : defaultType === 'TASK_COMMENT'
              ? 'New comment on a task'
              : 'Task status changed',
          message: isMention
            ? 'You were mentioned in a task comment.'
            : defaultMessage,
          resourceType: 'TASK',
          resourceId: task.id,
          eventKey: `task-event:${eventId}:${recipientId}`,
        };
      }),
    );
  }

  private commentMentionsName(body: string, name: string): boolean {
    const normalizedName = name.trim();
    if (!normalizedName) return false;
    const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])@${escapedName}(?=$|[^\\p{L}\\p{N}_])`,
      'iu',
    ).test(body);
  }

  private assertProjectIsActive(access: ProjectAccess): void {
    if (access.projectStatus !== 'ACTIVE') {
      throw new ConflictException(
        'Tasks in archived projects cannot be changed.',
      );
    }
  }

  private assertTaskIsActive(task: TaskRow): void {
    if (task.archivedAt) {
      throw new ConflictException(
        'Archived tasks cannot be changed. Restore the task first.',
      );
    }
  }

  private assertCanManage(role: OrganizationRole): void {
    if (!this.canManage(role)) {
      throw new ForbiddenException(
        'Only Owners, Admins, and Managers can manage task details.',
      );
    }
  }

  private canManage(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
  }

  private toDueAt(value: string | null | undefined): Date | null {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private toSummary(
    task: TaskRow,
    role: OrganizationRole,
    isProjectMember = true,
  ): TaskSummaryResponse {
    const activeBlocker = task.blockers.find(
      (blocker) => blocker.resolvedAt === null,
    );
    return {
      id: task.id,
      projectId: task.projectId,
      projectName: task.project.name,
      projectStatus: task.project.status,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      archivedAt: task.archivedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      creator: {
        id: task.creator.userId,
        name: task.creator.membership.user.name,
      },
      assignee: task.assignee
        ? {
            id: task.assignee.userId,
            name: task.assignee.membership.user.name,
          }
        : null,
      commentCount: task._count.comments,
      canManage: isProjectMember && this.canManage(role),
      canAssignOthers: isProjectMember && this.canManage(role),
      activeBlocker: activeBlocker
        ? {
            id: activeBlocker.id,
            reason: activeBlocker.reason,
            createdById: activeBlocker.createdById,
            createdByName: displayAttributionName(activeBlocker.creator.name),
            createdAt: activeBlocker.createdAt,
          }
        : null,
    };
  }

  private toDetails(
    task: TaskDetailsRow,
    role: OrganizationRole,
    isProjectMember = true,
  ): TaskDetailsResponse {
    return {
      ...this.toSummary(task, role, isProjectMember),
      canParticipate: isProjectMember,
      comments: [...task.comments].reverse().map((comment) => ({
        id: comment.id,
        authorId: comment.authorId,
        authorName: displayAttributionName(
          comment.author?.membership?.user?.name,
        ),
        body: comment.body,
        createdAt: comment.createdAt,
      })),
      activity: [...task.activities].reverse().map((activity) => ({
        id: activity.id,
        actorId: activity.actorId,
        actorName: displayAttributionName(
          activity.actor?.membership?.user?.name,
        ),
        type: activity.type,
        message: activity.message,
        createdAt: activity.createdAt,
      })),
      blockerHistory: [...task.blockers].reverse().map((blocker) => ({
        id: blocker.id,
        reason: blocker.reason,
        createdById: blocker.createdById,
        createdByName: displayAttributionName(blocker.creator.name),
        createdAt: blocker.createdAt,
        resolvedById: blocker.resolvedById,
        resolvedByName: blocker.resolver
          ? displayAttributionName(blocker.resolver.name)
          : null,
        resolvedAt: blocker.resolvedAt,
      })),
    };
  }
}
