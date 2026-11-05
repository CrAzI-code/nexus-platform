import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateProjectDiscussionDto,
  CreateProjectDiscussionPipe,
  ProjectDiscussionMessageDto,
  ProjectDiscussionMessagePipe,
} from './project-discussions.dto.js';
import {
  ProjectDiscussionsService,
  type DiscussionMessageResponse,
  type DiscussionMessagePage,
  type ProjectDiscussionPage,
  type ProjectDiscussionReadResponse,
  type ProjectDiscussionResponse,
} from './project-discussions.service.js';

@Controller('organizations/:organizationId/projects/:projectId/discussions')
@UseGuards(ClerkAuthGuard)
export class ProjectDiscussionsController {
  constructor(private readonly discussions: ProjectDiscussionsService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('before') before?: string,
  ): Promise<ProjectDiscussionPage> {
    return this.discussions.list(organizationId, projectId, user.id, before);
  }

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateProjectDiscussionPipe) body: CreateProjectDiscussionDto,
  ): Promise<ProjectDiscussionResponse> {
    return this.discussions.create(
      organizationId,
      projectId,
      user.id,
      body,
    );
  }

  @Get(':discussionId/messages')
  listMessages(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<DiscussionMessagePage> {
    return this.discussions.listMessages(
      organizationId,
      projectId,
      discussionId,
      user.id,
      before,
      limit,
    );
  }

  @Post(':discussionId/messages')
  addMessage(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(ProjectDiscussionMessagePipe) body: ProjectDiscussionMessageDto,
  ): Promise<DiscussionMessageResponse> {
    return this.discussions.addMessage(
      organizationId,
      projectId,
      discussionId,
      user.id,
      body.body,
    );
  }

  @Patch(':discussionId/messages/:messageId')
  editMessage(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(ProjectDiscussionMessagePipe) body: ProjectDiscussionMessageDto,
  ): Promise<DiscussionMessageResponse> {
    return this.discussions.editMessage(
      organizationId,
      projectId,
      discussionId,
      messageId,
      user.id,
      body.body,
    );
  }

  @Delete(':discussionId/messages/:messageId')
  deleteMessage(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DiscussionMessageResponse> {
    return this.discussions.deleteMessage(
      organizationId,
      projectId,
      discussionId,
      messageId,
      user.id,
    );
  }

  @Post(':discussionId/read')
  markRead(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectDiscussionReadResponse> {
    return this.discussions.markRead(
      organizationId,
      projectId,
      discussionId,
      user.id,
    );
  }
}
