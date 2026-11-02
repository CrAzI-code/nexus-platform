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
  AssignTaskDto,
  AssignTaskPipe,
  ChangeTaskStatusDto,
  ChangeTaskStatusPipe,
  CreateTaskCommentDto,
  CreateTaskCommentPipe,
  CreateTaskDto,
  CreateTaskPipe,
  UpdateTaskDto,
  UpdateTaskPipe,
} from './task.dto.js';
import {
  TasksService,
  type TaskDetailsResponse,
  type TaskProjectMemberResponse,
  type TaskSummaryResponse,
} from './tasks.service.js';

@Controller('organizations/:organizationId/projects/:projectId/tasks')
@UseGuards(ClerkAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateTaskPipe) body: CreateTaskDto,
  ): Promise<TaskSummaryResponse> {
    return this.tasks.create(organizationId, projectId, user.id, body);
  }

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskSummaryResponse[]> {
    return this.tasks.list(organizationId, projectId, user.id);
  }

  @Get('members')
  listMembers(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    members: TaskProjectMemberResponse[];
    canAssignOthers: boolean;
  }> {
    return this.tasks.listMembers(organizationId, projectId, user.id);
  }

  @Get(':taskId')
  get(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.get(organizationId, projectId, taskId, user.id);
  }

  @Patch(':taskId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(UpdateTaskPipe) body: UpdateTaskDto,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.update(organizationId, projectId, taskId, user.id, body);
  }

  @Patch(':taskId/assignee')
  assign(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(AssignTaskPipe) body: AssignTaskDto,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.assign(organizationId, projectId, taskId, user.id, body);
  }

  @Patch(':taskId/status')
  changeStatus(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(ChangeTaskStatusPipe) body: ChangeTaskStatusDto,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.changeStatus(
      organizationId,
      projectId,
      taskId,
      user.id,
      body,
    );
  }

  @Post(':taskId/comments')
  addComment(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateTaskCommentPipe) body: CreateTaskCommentDto,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.addComment(
      organizationId,
      projectId,
      taskId,
      user.id,
      body,
    );
  }

  @Patch(':taskId/archive')
  archive(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.archive(organizationId, projectId, taskId, user.id);
  }

  @Patch(':taskId/restore')
  restore(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDetailsResponse> {
    return this.tasks.restore(organizationId, projectId, taskId, user.id);
  }
}
