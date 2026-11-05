import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  OrganizationRole,
  TaskActivityType,
  TaskPriority,
  TaskStatus,
  WorkflowAutomationAction,
  WorkflowAutomationTrigger,
} from '../generated/prisma/client.js';
import {
  NotificationsService,
  type NewNotification,
} from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import type { SaveWorkflowAutomationDto } from './workflow-automations.dto.js';

const PROCESS_INTERVAL_MS = 30_000;
const MAX_EVENT_BATCH = 100;
const MAX_RETRIES = 3;

const executionSelect = {
  id: true,
  taskId: true,
  trigger: true,
  status: true,
  reason: true,
  error: true,
  attempt: true,
  triggeredAt: true,
  completedAt: true,
  task: { select: { title: true } },
} satisfies Prisma.WorkflowAutomationExecutionSelect;

const automationSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  name: true,
  trigger: true,
  conditionPriority: true,
  conditionStatus: true,
  conditionAssigneeId: true,
  action: true,
  actionValue: true,
  actionAssigneeId: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  executions: {
    orderBy: { triggeredAt: 'desc' },
    take: 5,
    select: executionSelect,
  },
} satisfies Prisma.WorkflowAutomationSelect;

type AutomationRow = Prisma.WorkflowAutomationGetPayload<{
  select: typeof automationSelect;
}>;
type Transaction = Prisma.TransactionClient;

interface AutomationCandidate {
  ruleId: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  trigger: WorkflowAutomationTrigger;
  eventKey: string;
  sourceActivityId?: string;
  executionId?: string;
}

interface TaskForAutomation {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  archivedAt: Date | null;
  creatorId: string;
  assigneeId: string | null;
  blockers: { id: string }[];
}

const taskForAutomationSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueAt: true,
  archivedAt: true,
  creatorId: true,
  assigneeId: true,
  blockers: {
    where: { resolvedAt: null },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.TaskSelect;

type RuleData = {
  name: string;
  trigger: WorkflowAutomationTrigger;
  conditionPriority: TaskPriority | null;
  conditionStatus: TaskStatus | null;
  conditionAssigneeId: string | null;
  action: WorkflowAutomationAction;
  actionValue: string | null;
  actionAssigneeId: string | null;
};

export type WorkflowExecutionResponse = {
  id: string;
  taskId: string;
  taskTitle: string;
  trigger: WorkflowAutomationTrigger;
  status: 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  reason: string | null;
  error: string | null;
  attempt: number;
  triggeredAt: Date;
  completedAt: Date | null;
};

export type WorkflowAutomationResponse = Omit<
  AutomationRow,
  'executions' | 'organizationId' | 'projectId'
> & {
  executions: WorkflowExecutionResponse[];
};

@Injectable()
export class WorkflowAutomationsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowAutomationsService.name);
  private interval: ReturnType<typeof setInterval> | undefined;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.processSafely();
    this.interval = setInterval(
      () => void this.processSafely(),
      PROCESS_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async list(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<WorkflowAutomationResponse[]> {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireManager(transaction, organizationId, projectId, userId);
      const rules = await transaction.workflowAutomation.findMany({
        where: { organizationId, projectId, deletedAt: null },
        select: automationSelect,
        orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
      });
      return rules.map((rule) => this.toResponse(rule));
    });
  }

  async create(
    organizationId: string,
    projectId: string,
    userId: string,
    input: SaveWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponse> {
    const rule = await this.prisma.$transaction(async (transaction) => {
      await this.requireManager(
        transaction,
        organizationId,
        projectId,
        userId,
        true,
      );
      await this.validateMembers(transaction, organizationId, projectId, input);
      return transaction.workflowAutomation.create({
        data: {
          organizationId,
          projectId,
          createdById: userId,
          ...this.toRuleData(input),
        },
        select: automationSelect,
      });
    });
    return this.toResponse(rule);
  }

  async update(
    organizationId: string,
    projectId: string,
    automationId: string,
    userId: string,
    input: SaveWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponse> {
    const rule = await this.prisma.$transaction(async (transaction) => {
      await this.requireManager(
        transaction,
        organizationId,
        projectId,
        userId,
        true,
      );
      await this.findRule(
        transaction,
        organizationId,
        projectId,
        automationId,
      );
      await this.validateMembers(transaction, organizationId, projectId, input);
      return transaction.workflowAutomation.update({
        where: { id: automationId },
        data: this.toRuleData(input),
        select: automationSelect,
      });
    });
    return this.toResponse(rule);
  }

  async setEnabled(
    organizationId: string,
    projectId: string,
    automationId: string,
    userId: string,
    enabled: boolean,
  ): Promise<WorkflowAutomationResponse> {
    const rule = await this.prisma.$transaction(async (transaction) => {
      await this.requireManager(
        transaction,
        organizationId,
        projectId,
        userId,
        true,
      );
      await this.findRule(
        transaction,
        organizationId,
        projectId,
        automationId,
      );
      return transaction.workflowAutomation.update({
        where: { id: automationId },
        data: { enabled },
        select: automationSelect,
      });
    });
    return this.toResponse(rule);
  }

  async remove(
    organizationId: string,
    projectId: string,
    automationId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireManager(
        transaction,
        organizationId,
        projectId,
        userId,
        true,
      );
      await this.findRule(
        transaction,
        organizationId,
        projectId,
        automationId,
      );
      await transaction.workflowAutomation.update({
        where: { id: automationId },
        data: { enabled: false, deletedAt: new Date() },
      });
    });
  }

  async listExecutions(
    organizationId: string,
    projectId: string,
    automationId: string,
    userId: string,
  ): Promise<WorkflowExecutionResponse[]> {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireManager(transaction, organizationId, projectId, userId);
      await this.findRule(
        transaction,
        organizationId,
        projectId,
        automationId,
        true,
      );
      const executions = await transaction.workflowAutomationExecution.findMany({
        where: { organizationId, projectId, ruleId: automationId },
        select: executionSelect,
        orderBy: { triggeredAt: 'desc' },
        take: 50,
      });
      return executions.map((execution) => this.toExecutionResponse(execution));
    });
  }

  private async requireManager(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    userId: string,
    requireActiveProject = false,
  ): Promise<void> {
    const [membership, project, projectMember] = await Promise.all([
      transaction.organizationMembership.findFirst({
        where: {
          organizationId,
          userId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { role: true },
      }),
      transaction.project.findFirst({
        where: { organizationId, id: projectId },
        select: { status: true },
      }),
      transaction.projectMember.findFirst({
        where: {
          organizationId,
          projectId,
          userId,
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
    ]);

    if (!membership || !project || !projectMember) {
      throw new NotFoundException('Project not found.');
    }
    if (!this.canManage(membership.role)) {
      throw new ForbiddenException(
        'Only Owners, Admins, and Managers can manage project automations.',
      );
    }
    if (requireActiveProject && project.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Automations in archived projects cannot be changed.',
      );
    }
  }

  private canManage(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
  }

  private async validateMembers(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    input: SaveWorkflowAutomationDto,
  ): Promise<void> {
    const userIds = [
      input.conditionAssigneeId,
      input.actionAssigneeId,
    ].filter((value): value is string => Boolean(value));
    if (userIds.length === 0) return;

    const members = await transaction.projectMember.findMany({
      where: {
        organizationId,
        projectId,
        userId: { in: userIds },
        status: 'ACTIVE',
        membership: {
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
      },
      select: { userId: true },
    });
    const activeIds = new Set(members.map((member) => member.userId));
    if (userIds.some((userId) => !activeIds.has(userId))) {
      throw new BadRequestException(
        'Automation assignees must be active members of this project.',
      );
    }
  }

  private toRuleData(input: SaveWorkflowAutomationDto): RuleData {
    return {
      name: input.name,
      trigger: input.trigger,
      conditionPriority: input.conditionPriority ?? null,
      conditionStatus: input.conditionStatus ?? null,
      conditionAssigneeId: input.conditionAssigneeId ?? null,
      action: input.action,
      actionValue: input.actionValue ?? null,
      actionAssigneeId: input.actionAssigneeId ?? null,
    };
  }

  private async findRule(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    ruleId: string,
    includeDeleted = false,
  ) {
    const rule = await transaction.workflowAutomation.findFirst({
      where: {
        id: ruleId,
        organizationId,
        projectId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      select: { id: true },
    });
    if (!rule) throw new NotFoundException('Automation not found.');
    return rule;
  }

  private toResponse(rule: AutomationRow): WorkflowAutomationResponse {
    return {
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      conditionPriority: rule.conditionPriority,
      conditionStatus: rule.conditionStatus,
      conditionAssigneeId: rule.conditionAssigneeId,
      action: rule.action,
      actionValue: rule.actionValue,
      actionAssigneeId: rule.actionAssigneeId,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      executions: rule.executions.map((execution) =>
        this.toExecutionResponse(execution),
      ),
    };
  }

  private toExecutionResponse(
    execution: Prisma.WorkflowAutomationExecutionGetPayload<{
      select: typeof executionSelect;
    }>,
  ): WorkflowExecutionResponse {
    return {
      id: execution.id,
      taskId: execution.taskId,
      taskTitle: execution.task.title,
      trigger: execution.trigger,
      status: execution.status,
      reason: execution.reason,
      error: execution.error,
      attempt: execution.attempt,
      triggeredAt: execution.triggeredAt,
      completedAt: execution.completedAt,
    };
  }

  private async processSafely(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.retryFailedExecutions();
      const rules = await this.prisma.workflowAutomation.findMany({
        where: { enabled: true, deletedAt: null },
        select: {
          id: true,
          organizationId: true,
          projectId: true,
          trigger: true,
          createdAt: true,
        },
      });
      for (const rule of rules) {
        await this.processRuleEvents(rule);
        if (
          rule.trigger === 'TASK_DUE_DATE_APPROACHING' ||
          rule.trigger === 'TASK_OVERDUE'
        ) {
          await this.processDueTasks(rule);
        }
      }
    } catch (error) {
      this.logger.error(
        'Workflow automation processing failed; the next scheduled run will retry.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  private async retryFailedExecutions(): Promise<void> {
    const failures = await this.prisma.workflowAutomationExecution.findMany({
      where: {
        status: 'FAILED',
        attempt: { lt: MAX_RETRIES },
        rule: { enabled: true, deletedAt: null },
      },
      select: {
        id: true,
        ruleId: true,
        organizationId: true,
        projectId: true,
        taskId: true,
        sourceActivityId: true,
        eventKey: true,
        trigger: true,
      },
      orderBy: { triggeredAt: 'asc' },
      take: MAX_EVENT_BATCH,
    });
    for (const failure of failures) {
      await this.runCandidate({
        ...failure,
        sourceActivityId: failure.sourceActivityId ?? undefined,
        executionId: failure.id,
      });
    }
  }

  private async processRuleEvents(rule: {
    id: string;
    organizationId: string;
    projectId: string;
    trigger: WorkflowAutomationTrigger;
    createdAt: Date;
  }): Promise<void> {
    const activityType = this.activityTypeFor(rule.trigger);
    if (!activityType) return;
    const activities = await this.prisma.taskActivity.findMany({
      where: {
        organizationId: rule.organizationId,
        projectId: rule.projectId,
        createdAt: { gte: rule.createdAt },
        type: activityType,
        automationExecutions: { none: { ruleId: rule.id } },
      },
      select: { id: true, taskId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_EVENT_BATCH,
    });
    for (const activity of activities) {
      await this.runCandidate({
        ruleId: rule.id,
        organizationId: rule.organizationId,
        projectId: rule.projectId,
        taskId: activity.taskId,
        trigger: rule.trigger,
        eventKey: `activity:${activity.id}`,
        sourceActivityId: activity.id,
      });
    }
  }

  private activityTypeFor(
    trigger: WorkflowAutomationTrigger,
  ): TaskActivityType | null {
    switch (trigger) {
      case 'TASK_CREATED':
        return 'CREATED';
      case 'TASK_STATUS_CHANGED':
        return 'STATUS_CHANGED';
      case 'TASK_ASSIGNED':
        return 'ASSIGNEE_CHANGED';
      case 'TASK_BLOCKER_REPORTED':
        return 'BLOCKER_CREATED';
      case 'TASK_BLOCKER_RESOLVED':
        return 'BLOCKER_RESOLVED';
      case 'TASK_DUE_DATE_APPROACHING':
      case 'TASK_OVERDUE':
        return null;
    }
  }

  private async processDueTasks(rule: {
    id: string;
    organizationId: string;
    projectId: string;
    trigger: WorkflowAutomationTrigger;
  }): Promise<void> {
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const tomorrow = new Date(today + 86_400_000);
    const dayAfter = new Date(today + 172_800_000);
    const overdue = rule.trigger === 'TASK_OVERDUE';
    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId: rule.organizationId,
        projectId: rule.projectId,
        archivedAt: null,
        status: { not: 'DONE' },
        project: {
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        dueAt: overdue
          ? { lt: new Date(today) }
          : { gte: tomorrow, lt: dayAfter },
      },
      select: { id: true, dueAt: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: MAX_EVENT_BATCH,
    });
    for (const task of tasks) {
      if (!task.dueAt) continue;
      await this.runCandidate({
        ruleId: rule.id,
        organizationId: rule.organizationId,
        projectId: rule.projectId,
        taskId: task.id,
        trigger: rule.trigger,
        eventKey: `${rule.trigger.toLowerCase()}:${task.id}:${task.dueAt.toISOString()}`,
      });
    }
  }

  private async runCandidate(candidate: AutomationCandidate): Promise<void> {
    try {
      await this.notifications.withTransaction(async (transaction, publish) => {
        if (candidate.executionId) {
          const claimed =
            await transaction.workflowAutomationExecution.updateMany({
              where: {
                id: candidate.executionId,
                status: 'FAILED',
                attempt: { lt: MAX_RETRIES },
              },
              data: {
                status: 'RUNNING',
                attempt: { increment: 1 },
                error: null,
                completedAt: null,
              },
            });
          if (claimed.count !== 1) return;
        } else {
          await transaction.workflowAutomationExecution.create({
            data: {
              organizationId: candidate.organizationId,
              projectId: candidate.projectId,
              ruleId: candidate.ruleId,
              taskId: candidate.taskId,
              sourceActivityId: candidate.sourceActivityId ?? null,
              eventKey: candidate.eventKey,
              trigger: candidate.trigger,
              status: 'RUNNING',
            },
          });
        }

        const rule = await transaction.workflowAutomation.findFirst({
          where: {
            id: candidate.ruleId,
            organizationId: candidate.organizationId,
            projectId: candidate.projectId,
            trigger: candidate.trigger,
            enabled: true,
            deletedAt: null,
          },
        });
        if (!rule) {
          await this.finishExecution(
            transaction,
            candidate,
            'SKIPPED',
            'The automation is disabled or no longer available.',
          );
          return;
        }

        const task = await transaction.task.findFirst({
          where: {
            id: candidate.taskId,
            organizationId: candidate.organizationId,
            projectId: candidate.projectId,
            project: {
              status: 'ACTIVE',
              organization: { status: 'ACTIVE' },
            },
          },
          select: taskForAutomationSelect,
        });
        if (!task || task.archivedAt) {
          await this.finishExecution(
            transaction,
            candidate,
            'SKIPPED',
            'The task is unavailable or archived.',
          );
          return;
        }

        const mismatch = this.conditionMismatch(rule, task);
        if (mismatch) {
          await this.finishExecution(
            transaction,
            candidate,
            'SKIPPED',
            mismatch,
          );
          return;
        }

        const result = await this.applyAction(
          transaction,
          publish,
          candidate,
          rule,
          task,
        );
        if (result.skipped) {
          await this.finishExecution(
            transaction,
            candidate,
            'SKIPPED',
            result.skipped,
          );
          return;
        }
        await this.finishExecution(
          transaction,
          candidate,
          'SUCCEEDED',
          result.reason,
        );
      });
    } catch (error) {
      if (
        !candidate.executionId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      await this.recordFailure(candidate, error);
    }
  }

  private conditionMismatch(
    rule: {
      conditionPriority: TaskPriority | null;
      conditionStatus: TaskStatus | null;
      conditionAssigneeId: string | null;
    },
    task: TaskForAutomation,
  ): string | null {
    if (rule.conditionPriority && rule.conditionPriority !== task.priority) {
      return `Skipped because priority is ${task.priority}, not ${rule.conditionPriority}.`;
    }
    if (rule.conditionStatus && rule.conditionStatus !== task.status) {
      return `Skipped because status is ${task.status}, not ${rule.conditionStatus}.`;
    }
    if (
      rule.conditionAssigneeId &&
      rule.conditionAssigneeId !== task.assigneeId
    ) {
      return 'Skipped because the task has a different assignee.';
    }
    return null;
  }

  private async applyAction(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    candidate: AutomationCandidate,
    rule: {
      id: string;
      createdById: string;
      name: string;
      action: WorkflowAutomationAction;
      actionValue: string | null;
      actionAssigneeId: string | null;
    },
    task: TaskForAutomation,
  ): Promise<{ skipped?: string; reason: string }> {
    if (rule.action === 'SEND_NOTIFICATION') {
      const recipients = await this.notificationRecipients(
        transaction,
        candidate,
        task,
      );
      if (recipients.length === 0) {
        return {
          skipped: 'No active task participants are available to notify.',
          reason: '',
        };
      }
      const executionId = await this.findExecutionId(transaction, candidate);
      await publish(
        recipients.map((recipientId) => ({
          recipientId,
          organizationId: candidate.organizationId,
          projectId: candidate.projectId,
          type: 'WORKFLOW_AUTOMATION',
          title: `Automation: ${rule.name}`,
          message: rule.actionValue ?? 'A project automation was triggered.',
          resourceType: 'TASK',
          resourceId: task.id,
          eventKey: `workflow-automation:${executionId}:${recipientId}`,
        })),
      );
      return { reason: `Notified ${recipients.length} relevant project member(s).` };
    }

    if (rule.action === 'CHANGE_STATUS') {
      const status = rule.actionValue as TaskStatus;
      if (status === task.status) {
        return {
          skipped: `The task is already ${status}.`,
          reason: '',
        };
      }
      if (task.blockers.length > 0 && status !== 'BLOCKED') {
        return {
          skipped: 'The task has an active blocker and cannot be unblocked by automation.',
          reason: '',
        };
      }
      const update = await transaction.task.updateMany({
        where: {
          id: task.id,
          organizationId: candidate.organizationId,
          projectId: candidate.projectId,
          archivedAt: null,
          status: task.status,
        },
        data: { status },
      });
      if (update.count !== 1) {
        throw new Error('Task changed while the automation was running.');
      }
      const activity = await transaction.taskActivity.create({
        data: {
          organizationId: candidate.organizationId,
          projectId: candidate.projectId,
          taskId: task.id,
          actorId: rule.createdById,
          type: 'AUTOMATION',
          message: `Automation "${rule.name}" changed status from ${task.status} to ${status}.`,
        },
        select: { id: true },
      });
      await this.notifyTaskParticipants(
        transaction,
        publish,
        candidate,
        task,
        activity.id,
        'TASK_STATUS_CHANGED',
        `Task status changed to ${status} by an automation.`,
      );
      return { reason: `Changed task status from ${task.status} to ${status}.` };
    }

    const assigneeId = rule.actionAssigneeId;
    if (!assigneeId) throw new Error('Automation assignment has no member.');
    if (assigneeId === task.assigneeId) {
      return {
        skipped: 'The task is already assigned to the selected member.',
        reason: '',
      };
    }
    const assignee = await transaction.projectMember.findFirst({
      where: {
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        userId: assigneeId,
        status: 'ACTIVE',
        membership: {
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
      },
      select: { userId: true },
    });
    if (!assignee) {
      return {
        skipped: 'The selected assignee is no longer an active project member.',
        reason: '',
      };
    }
    const update = await transaction.task.updateMany({
      where: {
        id: task.id,
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        archivedAt: null,
        assigneeId: task.assigneeId,
      },
      data: { assigneeId },
    });
    if (update.count !== 1) {
      throw new Error('Task changed while the automation was running.');
    }
    const activity = await transaction.taskActivity.create({
      data: {
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        taskId: task.id,
        actorId: rule.createdById,
        type: 'AUTOMATION',
        message: `Automation "${rule.name}" assigned this task to a project member.`,
      },
      select: { id: true },
    });
    await this.notifyTaskParticipants(
      transaction,
      publish,
      candidate,
      { ...task, assigneeId },
      activity.id,
      'TASK_ASSIGNED',
      'A task was assigned to you by a project automation.',
      assigneeId,
    );
    return { reason: 'Assigned the task to the selected project member.' };
  }

  private async notificationRecipients(
    transaction: Transaction,
    candidate: AutomationCandidate,
    task: TaskForAutomation,
  ): Promise<string[]> {
    const members = await transaction.projectMember.findMany({
      where: {
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        status: 'ACTIVE',
        membership: {
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
      },
      select: { userId: true, membership: { select: { role: true } } },
    });
    const participants = new Set([task.creatorId, task.assigneeId]);
    return members
      .filter(
        (member) =>
          participants.has(member.userId) ||
          member.membership.role === 'OWNER' ||
          member.membership.role === 'ADMIN' ||
          member.membership.role === 'MANAGER',
      )
      .map((member) => member.userId);
  }

  private async notifyTaskParticipants(
    transaction: Transaction,
    publish: (notifications: NewNotification[]) => Promise<void>,
    candidate: AutomationCandidate,
    task: TaskForAutomation,
    activityId: string,
    type: 'TASK_ASSIGNED' | 'TASK_STATUS_CHANGED',
    message: string,
    requiredRecipientId?: string,
  ): Promise<void> {
    const recipients = new Set(
      await this.notificationRecipients(transaction, candidate, task),
    );
    if (requiredRecipientId) recipients.add(requiredRecipientId);
    await publish(
      [...recipients].map((recipientId) => ({
        recipientId,
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        type,
        title: type === 'TASK_ASSIGNED' ? 'Task assigned' : 'Task status updated',
        message,
        resourceType: 'TASK',
        resourceId: task.id,
        eventKey: `automation-task:${activityId}:${recipientId}`,
      })),
    );
  }

  private async findExecutionId(
    transaction: Transaction,
    candidate: AutomationCandidate,
  ): Promise<string> {
    const execution = await transaction.workflowAutomationExecution.findUnique({
      where: {
        ruleId_eventKey: {
          ruleId: candidate.ruleId,
          eventKey: candidate.eventKey,
        },
      },
      select: { id: true },
    });
    if (!execution) throw new Error('Automation execution was not recorded.');
    return execution.id;
  }

  private async finishExecution(
    transaction: Transaction,
    candidate: AutomationCandidate,
    status: 'SUCCEEDED' | 'SKIPPED',
    reason: string,
  ): Promise<void> {
    await transaction.workflowAutomationExecution.update({
      where: {
        ruleId_eventKey: {
          ruleId: candidate.ruleId,
          eventKey: candidate.eventKey,
        },
      },
      data: {
        status,
        reason,
        error: null,
        completedAt: new Date(),
      },
    });
  }

  private async recordFailure(
    candidate: AutomationCandidate,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `Workflow automation ${candidate.ruleId} failed for task ${candidate.taskId}.`,
      error instanceof Error ? error.stack : undefined,
    );
    const failureMessage =
      'The action could not be completed. The worker will retry automatically.';
    try {
      await this.prisma.workflowAutomationExecution.upsert({
        where: {
          ruleId_eventKey: {
            ruleId: candidate.ruleId,
            eventKey: candidate.eventKey,
          },
        },
        create: {
          organizationId: candidate.organizationId,
          projectId: candidate.projectId,
          ruleId: candidate.ruleId,
          taskId: candidate.taskId,
          sourceActivityId: candidate.sourceActivityId ?? null,
          eventKey: candidate.eventKey,
          trigger: candidate.trigger,
          status: 'FAILED',
          error: failureMessage,
          completedAt: new Date(),
        },
        update: {
          status: 'FAILED',
          error: failureMessage,
          completedAt: new Date(),
          ...(candidate.executionId
            ? { attempt: { increment: 1 } }
            : {}),
        },
      });
    } catch (recordError) {
      this.logger.error(
        'Could not persist workflow automation failure history.',
        recordError instanceof Error ? recordError.stack : undefined,
      );
    }
  }
}
