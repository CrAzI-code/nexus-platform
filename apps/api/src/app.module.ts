import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PrismaModule } from './prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    TasksModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}