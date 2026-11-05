import { describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from './notifications.service.js';
import { NotificationStreamService } from './notification-stream.service.js';

const firstNotification: NotificationItem = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  organizationId: '123e4567-e89b-42d3-a456-426614174001',
  projectId: '123e4567-e89b-42d3-a456-426614174002',
  type: 'TASK_ASSIGNED',
  title: 'Task assigned',
  message: 'A task has been assigned to you.',
  resourceType: 'TASK',
  resourceId: '123e4567-e89b-42d3-a456-426614174003',
  readAt: null,
  createdAt: new Date('2026-11-03T10:00:00.000Z'),
};

async function flushPoll(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NotificationStreamService', () => {
  it('replays persisted notifications on connect and advances a stable SSE cursor', async () => {
    const service = new NotificationStreamService();
    const reader = vi.fn().mockResolvedValue([firstNotification]);
    const subscriber = vi.fn();
    const subscription = service
      .streamFor('recipient-id', reader)
      .subscribe(subscriber);
    await flushPoll();

    expect(reader).toHaveBeenCalledWith(null, 100);
    expect(subscriber).toHaveBeenCalledWith({
      id: `${firstNotification.createdAt.toISOString()}|${firstNotification.id}`,
      type: 'notification',
      data: firstNotification,
    });

    subscription.unsubscribe();
    service.onModuleDestroy();
  });

  it('recovers persisted events after the last SSE cursor when a client reconnects', async () => {
    const service = new NotificationStreamService();
    const recovered = {
      ...firstNotification,
      id: '123e4567-e89b-42d3-a456-426614174004',
      createdAt: new Date('2026-11-03T10:01:00.000Z'),
    };
    const reader = vi.fn().mockResolvedValue([recovered]);
    const subscriber = vi.fn();
    const cursor = `${firstNotification.createdAt.toISOString()}|${firstNotification.id}`;
    const subscription = service
      .streamFor('recipient-id', reader, cursor)
      .subscribe(subscriber);
    await flushPoll();

    expect(reader).toHaveBeenCalledWith(
      { createdAt: firstNotification.createdAt, id: firstNotification.id },
      100,
    );
    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${recovered.createdAt.toISOString()}|${recovered.id}`,
        data: recovered,
      }),
    );

    subscription.unsubscribe();
    service.onModuleDestroy();
  });

  it('orders notifications with the same timestamp by their UUID cursor', async () => {
    const service = new NotificationStreamService();
    const sameTimestamp = new Date(firstNotification.createdAt);
    const first = {
      ...firstNotification,
      id: '123e4567-e89b-42d3-a456-426614174001',
      createdAt: sameTimestamp,
    };
    const next = {
      ...firstNotification,
      id: '123e4567-e89b-42d3-a456-426614174002',
      createdAt: sameTimestamp,
    };
    const reader = vi
      .fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValue([next]);
    const subscriber = vi.fn();
    const subscription = service
      .streamFor('recipient-id', reader)
      .subscribe(subscriber);
    await flushPoll();
    service.publish([
      { recipientId: 'recipient-id', notification: next },
    ]);
    await flushPoll();

    expect(
      subscriber.mock.calls.filter(([event]) => event.type === 'notification'),
    ).toHaveLength(2);
    expect(subscriber).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: next }),
    );

    subscription.unsubscribe();
    service.onModuleDestroy();
  });

  it('queries persisted state on other instances’ commits and does not duplicate cursor events', async () => {
    vi.useFakeTimers();
    try {
      const instanceA = new NotificationStreamService();
      const instanceB = new NotificationStreamService();
      let persisted: NotificationItem[] = [];
      const reader = vi.fn(async (cursor) =>
        persisted.filter(
          (item) =>
            !cursor ||
            item.createdAt > cursor.createdAt ||
            (item.createdAt.getTime() === cursor.createdAt.getTime() &&
              item.id.localeCompare(cursor.id) > 0),
        ),
      );
      const subscriber = vi.fn();
      const subscription = instanceA
        .streamFor('recipient-id', reader)
        .subscribe(subscriber);
      await flushPoll();
      persisted = [firstNotification];

      instanceB.publish([
        { recipientId: 'recipient-id', notification: firstNotification },
      ]);
      await vi.advanceTimersByTimeAsync(3_000);

      const notificationEvents = subscriber.mock.calls.filter(
        ([event]) => event.type === 'notification',
      );
      expect(notificationEvents).toHaveLength(1);
      expect(reader).toHaveBeenCalledTimes(2);

      subscription.unsubscribe();
      instanceA.onModuleDestroy();
      instanceB.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wakes local subscribers from persisted storage after a committed notification', async () => {
    const service = new NotificationStreamService();
    let persisted: NotificationItem[] = [];
    const reader = vi.fn(async (cursor) =>
      persisted.filter(
        (item) =>
          !cursor || item.createdAt.getTime() > cursor.createdAt.getTime(),
      ),
    );
    const subscriber = vi.fn();
    const subscription = service
      .streamFor('recipient-id', reader)
      .subscribe(subscriber);
    await flushPoll();
    persisted = [firstNotification];

    service.publish([
      { recipientId: 'recipient-id', notification: firstNotification },
    ]);
    await flushPoll();

    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({ data: firstNotification }),
    );
    subscription.unsubscribe();
    service.onModuleDestroy();
  });

  it('cleans up polling and heartbeat work when a connection closes or the module stops', async () => {
    vi.useFakeTimers();
    try {
      const service = new NotificationStreamService();
      const reader = vi.fn().mockResolvedValue([]);
      const subscriber = vi.fn();
      const subscription = service
        .streamFor('recipient-id', reader)
        .subscribe(subscriber);
      await flushPoll();
      expect(reader).toHaveBeenCalledTimes(1);

      subscription.unsubscribe();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(reader).toHaveBeenCalledTimes(1);
      expect(subscriber).not.toHaveBeenCalled();

      const second = service
        .streamFor('other-recipient', reader)
        .subscribe(subscriber);
      service.onModuleDestroy();
      expect(second.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
