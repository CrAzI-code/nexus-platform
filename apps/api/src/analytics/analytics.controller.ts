import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AnalyticsQueryPipe } from './analytics.dto.js';
import {
  AnalyticsService,
  type OrganizationAnalyticsResponse,
  type ProjectAnalyticsResponse,
} from './analytics.service.js';

@Controller('organizations/:organizationId')
@UseGuards(ClerkAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics')
  organization(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(AnalyticsQueryPipe) query: ReturnType<AnalyticsQueryPipe['transform']>,
  ): Promise<OrganizationAnalyticsResponse> {
    return this.analytics.getOrganizationAnalytics(organizationId, user.id, query);
  }

  @Get('projects/:projectId/analytics')
  project(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(AnalyticsQueryPipe) query: ReturnType<AnalyticsQueryPipe['transform']>,
  ): Promise<ProjectAnalyticsResponse> {
    return this.analytics.getProjectAnalytics(organizationId, projectId, user.id, query);
  }
}