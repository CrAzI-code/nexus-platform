import {
  Injectable,
  OnModuleDestroy,
  type MessageEvent,
} from '@nestjs/common';
import { Observable, type Subscriber } from 'rxjs';
import type { NotificationItem } from './notifications.service.js';

export interface PersistedNotificationEvent {
  recipientId: string;
  notification: NotificationItem;
}

@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  private readonly subscribers = new Map<
    string,
    Set<Subscriber<MessageEvent>>
  >();

  streamFor(recipientId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let recipientSubscribers = this.subscribers.get(recipientId);
      if (!recipientSubscribers) {
        recipientSubscribers = new Set();
        this.subscribers.set(recipientId, recipientSubscribers);
      }
      recipientSubscribers.add(subscriber);

      const heartbeat = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        });
      }, 25_000);

      return () => {
        clearInterval(heartbeat);
        const currentSubscribers = this.subscribers.get(recipientId);
        currentSubscribers?.delete(subscriber);
        if (currentSubscribers?.size === 0) {
          this.subscribers.delete(recipientId);
        }
      };
    });
  }

  publish(events: PersistedNotificationEvent[]): void {
    for (const event of events) {
      const subscribers = this.subscribers.get(event.recipientId);
      if (!subscribers) continue;

      for (const subscriber of Array.from(subscribers)) {
        subscriber.next({
          id: event.notification.id,
          type: 'notification',
          data: event.notification,
        });
      }
    }
  }

  onModuleDestroy(): void {
    for (const subscriber of Array.from(this.subscribers.values()).flatMap(
      (set) => Array.from(set),
    )) {
      subscriber.complete();
    }
    this.subscribers.clear();
  }
}
