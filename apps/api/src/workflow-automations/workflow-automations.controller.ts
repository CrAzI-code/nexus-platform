import {
  Body,
  Controller,
  Delete,
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
  SaveWorkflowAutomationDto,
  SaveWorkflowAutomationPipe,
  SetWorkflowAutomationEnabledDto,
  SetWorkflowAutomationEnabledPipe,
} from './workflow-automations.dto.js';
import {
  WorkflowAutomationsService,
  type WorkflowAutomationResponse,
  type WorkflowExecutionResponse,
} from './workflow-automations.service.js';

@Controller('organizations/:organizationId/projects/:projectId/automations')
@UseGuards(ClerkAuthGuard)
export class WorkflowAutomationsController {
  constructor(private readonly automations: WorkflowAutomationsService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkflowAutomationResponse[]> {
    return this.automations.list(
      organizationId,
      projectId,
      user.id,
    );
  }

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(SaveWorkflowAutomationPipe) body: SaveWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponse> {
    return this.automations.create(
      organizationId,
      projectId,
      user.id,
      body,
    );
  }

  @Patch(':automationId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('automationId', ParseUUIDPipe) automationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(SaveWorkflowAutomationPipe) body: SaveWorkflowAutomationDto,
  ): Promise<WorkflowAutomationResponse> {
    return this.automations.update(
      organizationId,
      projectId,
      automationId,
      user.id,
      body,
    );
  }

  @Patch(':automationId/enabled')
  setEnabled(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('automationId', ParseUUIDPipe) automationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(SetWorkflowAutomationEnabledPipe)
    body: SetWorkflowAutomationEnabledDto,
  ): Promise<WorkflowAutomationResponse> {
    return this.automations.setEnabled(
      organizationId,
      projectId,
      automationId,
      user.id,
      body.enabled,
    );
  }

  @Delete(':automationId')
  async remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('automationId', ParseUUIDPipe) automationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    await this.automations.remove(
      organizationId,
      projectId,
      automationId,
      user.id,
    );
    return { deleted: true };
  }

  @Get(':automationId/executions')
  listExecutions(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('automationId', ParseUUIDPipe) automationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkflowExecutionResponse[]> {
    return this.automations.listExecutions(
      organizationId,
      projectId,
      automationId,
      user.id,
    );
  }
}
