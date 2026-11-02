import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PrismaModule } from './prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';

@Module({
  imports: [PrismaModule, AuthModule, OrganizationsModule, ProjectsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}