import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { EmailModule } from '../email/email.module.js';
import { PrismaModule } from '../prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import {
  InvitationAcceptanceController,
  OrganizationTeamController,
} from './organization-team.controller.js';
import { OrganizationTeamService } from './organization-team.service.js';

@Module({
  imports: [AuthModule, EmailModule, PrismaModule, NotificationsModule],
  controllers: [
    OrganizationsController,
    OrganizationTeamController,
    InvitationAcceptanceController,
  ],
  providers: [ClerkAuthGuard, OrganizationsService, OrganizationTeamService],
})
export class OrganizationsModule {}
