import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma.module.js';
import { ProjectDiscussionsController } from './project-discussions.controller.js';
import { ProjectDiscussionsService } from './project-discussions.service.js';

@Module({
  imports: [AuthModule, PrismaModule, NotificationsModule],
  controllers: [ProjectDiscussionsController],
  providers: [ClerkAuthGuard, ProjectDiscussionsService],
})
export class ProjectDiscussionsModule {}
