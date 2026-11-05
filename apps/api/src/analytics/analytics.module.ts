import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AnalyticsController],
  providers: [ClerkAuthGuard, AnalyticsService],
})
export class AnalyticsModule {}