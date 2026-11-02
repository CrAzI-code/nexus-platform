import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AuditLogsController],
  providers: [ClerkAuthGuard, AuditLogsService],
})
export class AuditLogsModule {}
