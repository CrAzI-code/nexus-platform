import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { OverdueNotificationsService } from './overdue-notifications.service.js';

const dueRecipient = {
  taskId: '123e4567-e89b-42d3-a456-426614174000',
  organizationId: '123e4567-e89b-42d3-a456-426614174001',
  projectId: '123e4567-e89b-42d3-a456-426614174002',
  dueAt: new Date('2026-11-02T00:00:00.000Z'),
  recipientId: '123e4567-e89b-42d3-a456-426614174003',
};

describe('OverdueNotificationsService', () => {
  let service: OverdueNotificationsService;
  const transaction = { $queryRaw: vi.fn() };
  const notifications = {
    withTransaction: vi.fn(),
  };
  const prisma = {};
  const publish = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([dueRecipient]);
    notifications.withTransaction.mockImplementation(
      async (
        operation: (
          tx: typeof transaction,
          publishNotifications: typeof publish,
        ) => Promise<number>,
      ) => operation(transaction, publish),
    );
    publish.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        OverdueNotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(OverdueNotificationsService);
  });

  it('selects and persists overdue task notifications with stable UTC event keys', async () => {
    await expect(service.processBatch()).resolves.toBe(1);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith([
      {
        recipientId: dueRecipient.recipientId,
        organizationId: dueRecipient.organizationId,
        projectId: dueRecipient.projectId,
        type: 'TASK_OVERDUE',
        title: 'Task is overdue',
        message: 'A task you follow has passed its due date.',
        resourceType: 'TASK',
        resourceId: dueRecipient.taskId,
        eventKey: `task-overdue:${dueRecipient.taskId}:2026-11-02T00:00:00.000Z:${dueRecipient.recipientId}`,
      },
    ]);
  });

  it('does not scan or publish when another API instance owns the advisory lock', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: false }]);

    await expect(service.processBatch()).resolves.toBe(0);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish when all due tasks are completed, changed, or already delivered', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);

    await expect(service.processBatch()).resolves.toBe(0);

    expect(publish).not.toHaveBeenCalled();
    const query = transaction.$queryRaw.mock.calls[1][0];
    expect(query.sql).toContain("task.status <> 'DONE'");
    expect(query.sql).toContain('task.due_at');
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql).toContain('FOR UPDATE OF task SKIP LOCKED');
  });

  it('uses the current due date as the deduplication generation', async () => {
    const updatedDueDate = new Date('2026-11-03T00:00:00.000Z');
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ ...dueRecipient, dueAt: updatedDueDate }]);

    await service.processBatch();

    expect(publish).toHaveBeenCalledWith([
      expect.objectContaining({
        eventKey: `task-overdue:${dueRecipient.taskId}:2026-11-03T00:00:00.000Z:${dueRecipient.recipientId}`,
      }),
    ]);
  });

  it('releases its local processing guard after a database error so later runs can recover', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.processBatch()).rejects.toThrow(
      'database unavailable',
    );

    transaction.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);
    await expect(service.processBatch()).resolves.toBe(0);
  });

  it('supports a fresh worker after restart and relies on persistent database state', async () => {
    await service.processBatch();
    const restarted = await Test.createTestingModule({
      providers: [
        OverdueNotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    const newWorker = restarted.get(OverdueNotificationsService);

    transaction.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);
    await expect(newWorker.processBatch()).resolves.toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('drains full batches immediately instead of waiting for the next interval', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, index) => ({
      ...dueRecipient,
      taskId: `${dueRecipient.taskId.slice(0, -1)}${index % 10}`,
    }));
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);

    service.onModuleInit();
    try {
      await vi.waitFor(() => {
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(4);
      });
    } finally {
      service.onModuleDestroy();
    }

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toHaveLength(500);
  });

  it('schedules a recovery scan on startup and stops its timer on shutdown', async () => {
    vi.useFakeTimers();
    try {
      transaction.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([]);
      service.onModuleInit();
      await vi.waitFor(() => {
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
      });

      service.onModuleDestroy();
      transaction.$queryRaw.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transaction.$queryRaw).not.toHaveBeenCalled();
    } finally {
      service.onModuleDestroy();
      vi.useRealTimers();
    }
  });
});
