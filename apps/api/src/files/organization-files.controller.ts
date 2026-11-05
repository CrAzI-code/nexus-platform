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
import { FileListPipe, type FileListQuery } from './files.dto.js';
import { FilesService, type OrganizationFilePage } from './files.service.js';

@Controller('organizations/:organizationId/files')
@UseGuards(ClerkAuthGuard)
export class OrganizationFilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(FileListPipe) query: FileListQuery,
  ): Promise<OrganizationFilePage> {
    return this.files.listOrganizationFiles(organizationId, user.id, query);
  }
}
