import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule, PrismaModule, NotificationsModule],
  controllers: [TasksController],
  providers: [ClerkAuthGuard, TasksService],
})
export class TasksModule {}
