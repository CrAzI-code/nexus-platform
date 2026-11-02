import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationStreamService } from './notification-stream.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationStreamService],
  exports: [NotificationsService, NotificationStreamService],
})
export class NotificationsModule {}
