import { describe, expect, it, vi } from 'vitest';
import { NotificationStreamService } from './notification-stream.service.js';

describe('NotificationStreamService', () => {
  it('delivers events only to subscribers for the matching recipient', () => {
    const service = new NotificationStreamService();
    const alice = vi.fn();
    const bob = vi.fn();
    service.streamFor('alice').subscribe(alice);
    service.streamFor('bob').subscribe(bob);

    service.publish([
      {
        recipientId: 'alice',
        notification: {
          id: 'notification-1',
          organizationId: 'organization-1',
          projectId: null,
          type: 'TEAM_UPDATED',
          title: 'Team updated',
          message: 'A team update is available.',
          resourceType: 'ORGANIZATION',
          resourceId: 'organization-1',
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    expect(alice).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification',
        data: expect.objectContaining({ id: 'notification-1' }),
      }),
    );
    expect(bob).not.toHaveBeenCalled();
  });

  it('supports multiple simultaneous connections for one recipient', () => {
    const service = new NotificationStreamService();
    const first = vi.fn();
    const second = vi.fn();
    service.streamFor('alice').subscribe(first);
    service.streamFor('alice').subscribe(second);

    service.publish([
      {
        recipientId: 'alice',
        notification: {
          id: 'notification-2',
          organizationId: 'organization-1',
          projectId: null,
          type: 'TEAM_UPDATED',
          title: 'Team updated',
          message: 'A team update is available.',
          resourceType: 'ORGANIZATION',
          resourceId: 'organization-1',
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removes disconnected subscribers', () => {
    const service = new NotificationStreamService();
    const subscriber = vi.fn();
    const subscription = service.streamFor('alice').subscribe(subscriber);
    subscription.unsubscribe();

    service.publish([
      {
        recipientId: 'alice',
        notification: {
          id: 'notification-3',
          organizationId: 'organization-1',
          projectId: null,
          type: 'TEAM_UPDATED',
          title: 'Team updated',
          message: 'A team update is available.',
          resourceType: 'ORGANIZATION',
          resourceId: 'organization-1',
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('sends heartbeat events and cleans up on shutdown', () => {
    vi.useFakeTimers();
    try {
      const service = new NotificationStreamService();
      const subscriber = vi.fn();
      const subscription = service.streamFor('alice').subscribe(subscriber);
      vi.advanceTimersByTime(25_000);
      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'heartbeat' }),
      );

      service.onModuleDestroy();
      expect(subscription.closed).toBe(true);
      subscriber.mockClear();
      service.publish([]);
      expect(subscriber).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
