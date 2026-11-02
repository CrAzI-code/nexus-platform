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
import {
  AuditLogListPipe,
  type AuditLogListQuery,
} from './audit-logs.dto.js';
import {
  AuditLogsService,
  type AuditLogPage,
} from './audit-logs.service.js';

@Controller('organizations/:organizationId/audit-logs')
@UseGuards(ClerkAuthGuard)
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(AuditLogListPipe) query: AuditLogListQuery,
  ): Promise<AuditLogPage> {
    return this.auditLogs.list(organizationId, user.id, query);
  }
}
