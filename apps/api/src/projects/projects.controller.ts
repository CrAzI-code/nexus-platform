import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateProjectDto,
  CreateProjectPipe,
  UpdateProjectDto,
  UpdateProjectPipe,
} from './project.dto.js';
import {
  ProjectsService,
  type ProjectResponse,
} from './projects.service.js';

@Controller('organizations/:organizationId/projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateProjectPipe) body: CreateProjectDto,
  ): Promise<ProjectResponse> {
    return this.projects.create(organizationId, user.id, body);
  }

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectResponse[]> {
    return this.projects.list(organizationId, user.id);
  }

  @Get(':projectId')
  get(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    return this.projects.get(organizationId, projectId, user.id);
  }

  @Patch(':projectId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(UpdateProjectPipe) body: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    return this.projects.update(organizationId, projectId, user.id, body);
  }

  @Patch(':projectId/archive')
  archive(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    return this.projects.archive(organizationId, projectId, user.id);
  }
}
