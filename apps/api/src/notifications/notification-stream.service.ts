import {
  Injectable,
  Logger,
  OnModuleDestroy,
  type MessageEvent,
} from '@nestjs/common';
import { Observable, type Subscriber } from 'rxjs';
import type { NotificationItem } from './notifications.service.js';

const POLL_INTERVAL_MS = 3_000;
const STREAM_BATCH_SIZE = 100;

export interface PersistedNotificationEvent {
  recipientId: string;
  notification: NotificationItem;
}

export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

export type NotificationReader = (
  cursor: NotificationCursor | null,
  take: number,
) => Promise<NotificationItem[]>;

interface StreamConnection {
  subscriber: Subscriber<MessageEvent>;
  read: NotificationReader;
  cursor: NotificationCursor | null;
  polling: boolean;
  active: boolean;
  pollTimer: ReturnType<typeof setInterval>;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

function parseCursor(value: string | undefined): NotificationCursor | null {
  if (!value) return null;
  const separator = value.lastIndexOf('|');
  if (separator <= 0) return null;
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      id,
    )
  ) {
    return null;
  }
  return { createdAt, id };
}

function cursorFor(notification: NotificationItem): NotificationCursor {
  return { createdAt: notification.createdAt, id: notification.id };
}

function compareCursor(
  left: NotificationCursor,
  right: NotificationCursor,
): number {
  const timeDifference = left.createdAt.getTime() - right.createdAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function eventId(cursor: NotificationCursor): string {
  return `${cursor.createdAt.toISOString()}|${cursor.id}`;
}

@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreamService.name);
  private readonly subscribers = new Map<string, Set<StreamConnection>>();

  streamFor(
    recipientId: string,
    read: NotificationReader,
    lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const connection: StreamConnection = {
        subscriber,
        read,
        cursor: parseCursor(lastEventId),
        polling: false,
        active: true,
        pollTimer: setInterval(
          () => void this.poll(recipientId, connection),
          POLL_INTERVAL_MS,
        ),
        heartbeatTimer: setInterval(() => {
          subscriber.next({
            type: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          });
        }, 25_000),
      };

      let recipientSubscribers = this.subscribers.get(recipientId);
      if (!recipientSubscribers) {
        recipientSubscribers = new Set();
        this.subscribers.set(recipientId, recipientSubscribers);
      }
      recipientSubscribers.add(connection);
      void this.poll(recipientId, connection);

      return () => {
        connection.active = false;
        clearInterval(connection.pollTimer);
        clearInterval(connection.heartbeatTimer);
        const currentSubscribers = this.subscribers.get(recipientId);
        currentSubscribers?.delete(connection);
        if (currentSubscribers?.size === 0) {
          this.subscribers.delete(recipientId);
        }
      };
    });
  }

  publish(events: PersistedNotificationEvent[]): void {
    const recipientIds = new Set(events.map((event) => event.recipientId));
    for (const recipientId of recipientIds) {
      const connections = this.subscribers.get(recipientId);
      if (!connections) continue;
      for (const connection of connections) {
        void this.poll(recipientId, connection);
      }
    }
  }

  onModuleDestroy(): void {
    for (const [recipientId, connections] of this.subscribers) {
      for (const connection of connections) {
        connection.active = false;
        clearInterval(connection.pollTimer);
        clearInterval(connection.heartbeatTimer);
        connection.subscriber.complete();
      }
      this.subscribers.delete(recipientId);
    }
  }

  private async poll(
    recipientId: string,
    connection: StreamConnection,
  ): Promise<void> {
    if (!connection.active || connection.polling) return;
    connection.polling = true;
    try {
      const notifications = await connection.read(
        connection.cursor,
        STREAM_BATCH_SIZE,
      );
      if (!connection.active) return;
      for (const notification of notifications) {
        const nextCursor = cursorFor(notification);
        if (
          connection.cursor &&
          compareCursor(nextCursor, connection.cursor) <= 0
        ) {
          continue;
        }
        connection.cursor = nextCursor;
        connection.subscriber.next({
          id: eventId(nextCursor),
          type: 'notification',
          data: notification,
        });
      }
    } catch (error) {
      if (connection.active) {
        this.logger.warn(
          `Persisted notification stream poll failed for recipient ${recipientId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    } finally {
      connection.polling = false;
    }
  }
}
