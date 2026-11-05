import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { WorkflowAutomationsController } from './workflow-automations.controller.js';
import { WorkflowAutomationsService } from './workflow-automations.service.js';

@Module({
  imports: [AuthModule, PrismaModule, NotificationsModule],
  controllers: [WorkflowAutomationsController],
  providers: [ClerkAuthGuard, WorkflowAutomationsService],
})
export class WorkflowAutomationsModule {}
