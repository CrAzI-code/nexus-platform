import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  NotificationListPipe,
  type NotificationListQuery,
} from './notifications.dto.js';
import {
  NotificationsService,
  type NotificationItem,
  type NotificationPage,
} from './notifications.service.js';
import { NotificationStreamService } from './notification-stream.service.js';

@Controller('notifications')
@UseGuards(ClerkAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly stream: NotificationStreamService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(NotificationListPipe) query: NotificationListQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(
      user.id,
      user.email,
      user.primaryEmailVerified === true,
      query.page,
      query.pageSize,
    );
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Sse('stream')
  streamNotifications(
    @CurrentUser() user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    return this.stream.streamFor(user.id);
  }

  @Patch(':notificationId/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<NotificationItem> {
    return this.notifications.markRead(
      notificationId,
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Patch('read-all')
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Delete(':notificationId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<{ deleted: true }> {
    return this.notifications.remove(notificationId, user.id);
  }
}
