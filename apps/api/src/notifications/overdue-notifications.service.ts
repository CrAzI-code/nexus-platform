import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import {
  NotificationsService,
  type NewNotification,
} from './notifications.service.js';

const PROCESS_INTERVAL_MS = 60_000;
const PROCESS_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 20;
const OVERDUE_WORKER_LOCK = 1_779_034_227;

interface OverdueRecipient {
  taskId: string;
  organizationId: string;
  projectId: string;
  dueAt: Date;
  recipientId: string;
}

@Injectable()
export class OverdueNotificationsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OverdueNotificationsService.name);
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

  async processBatch(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    try {
      return await this.notifications.withTransaction(
        async (transaction, publish) => {
          const lock = await transaction.$queryRaw<{ locked: boolean }[]>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(${OVERDUE_WORKER_LOCK}) AS locked`,
          );
          if (!lock[0]?.locked) return 0;

          const dueRecipients = await transaction.$queryRaw<
            OverdueRecipient[]
          >(Prisma.sql`
            SELECT
              task.id AS "taskId",
              task.organization_id AS "organizationId",
              task.project_id AS "projectId",
              task.due_at AS "dueAt",
              recipient.user_id AS "recipientId"
            FROM tasks AS task
            CROSS JOIN LATERAL (
              SELECT candidate.user_id
              FROM (VALUES (task.creator_id), (task.assignee_id)) AS candidate(user_id)
              WHERE candidate.user_id IS NOT NULL
              GROUP BY candidate.user_id
            ) AS recipient
            INNER JOIN project_members AS project_member
              ON project_member.organization_id = task.organization_id
              AND project_member.project_id = task.project_id
              AND project_member.user_id = recipient.user_id
              AND project_member.status = 'ACTIVE'
            INNER JOIN organization_memberships AS membership
              ON membership.organization_id = task.organization_id
              AND membership.user_id = recipient.user_id
              AND membership.status = 'ACTIVE'
            INNER JOIN organizations AS organization
              ON organization.id = task.organization_id
              AND organization.status = 'ACTIVE'
            INNER JOIN projects AS project
              ON project.organization_id = task.organization_id
              AND project.id = task.project_id
              AND project.status = 'ACTIVE'
            WHERE task.archived_at IS NULL
              AND task.status <> 'DONE'
              AND task.due_at IS NOT NULL
              AND task.due_at < (
                date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM notifications AS notification
                WHERE notification.recipient_id = recipient.user_id
                  AND notification.event_key =
                    'task-overdue:' || task.id::text || ':' ||
                    to_char(
                      task.due_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ) || ':' || recipient.user_id::text
              )
            ORDER BY task.due_at ASC, task.id ASC, recipient.user_id ASC
            LIMIT ${PROCESS_BATCH_SIZE}
            FOR UPDATE OF task SKIP LOCKED
          `);

          if (dueRecipients.length === 0) return 0;
          const notifications = dueRecipients.map((candidate) =>
            this.toNotification(candidate),
          );
          await publish(notifications);
          return notifications.length;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } finally {
      this.isProcessing = false;
    }
  }

  private toNotification(candidate: OverdueRecipient): NewNotification {
    return {
      recipientId: candidate.recipientId,
      organizationId: candidate.organizationId,
      projectId: candidate.projectId,
      type: 'TASK_OVERDUE',
      title: 'Task is overdue',
      message: 'A task you follow has passed its due date.',
      resourceType: 'TASK',
      resourceId: candidate.taskId,
      eventKey: `task-overdue:${candidate.taskId}:${candidate.dueAt.toISOString()}:${candidate.recipientId}`,
    };
  }

  private async processSafely(): Promise<void> {
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const processed = await this.processBatch();
        if (processed < PROCESS_BATCH_SIZE) return;
      }
    } catch (error) {
      this.logger.error(
        'Overdue notification processing failed; the next scheduled run will retry.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
