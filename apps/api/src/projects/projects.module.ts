import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { PrismaModule } from '../prisma.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProjectsController],
  providers: [ClerkAuthGuard, ProjectsService],
})
export class ProjectsModule {}
