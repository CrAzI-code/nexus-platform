import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FileListPipe, type FileListQuery } from './files.dto.js';
import {
  FilesService,
  type FileAttachmentPage,
  type FileAttachmentResponse,
} from './files.service.js';
import {
  MAX_FILE_UPLOAD_HARD_LIMIT,
  type UploadFileData,
} from './file-validation.js';

const fileUploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_FILE_UPLOAD_HARD_LIMIT, files: 1 },
});

@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(ClerkAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('files')
  listProjectFiles(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(FileListPipe) query: FileListQuery,
  ): Promise<FileAttachmentPage> {
    return this.files.listProjectFiles(
      organizationId,
      projectId,
      user.id,
      query,
    );
  }

  @Post('files')
  @UseInterceptors(fileUploadInterceptor)
  uploadProjectFile(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFileData | undefined,
  ): Promise<FileAttachmentResponse> {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.files.uploadProjectFile(
      organizationId,
      projectId,
      user.id,
      file,
    );
  }

  @Get('tasks/:taskId/attachments')
  listTaskAttachments(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(FileListPipe) query: FileListQuery,
  ): Promise<FileAttachmentPage> {
    return this.files.listTaskAttachments(
      organizationId,
      projectId,
      taskId,
      user.id,
      query,
    );
  }

  @Post('tasks/:taskId/attachments')
  @UseInterceptors(fileUploadInterceptor)
  uploadTaskAttachment(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFileData | undefined,
  ): Promise<FileAttachmentResponse> {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.files.uploadTaskAttachment(
      organizationId,
      projectId,
      taskId,
      user.id,
      file,
    );
  }

  @Get('files/:fileId/content')
  async getContent(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('disposition') disposition: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const requestedDisposition = disposition ?? 'attachment';
    if (
      requestedDisposition !== 'attachment' &&
      requestedDisposition !== 'inline'
    ) {
      throw new BadRequestException('Choose a supported file disposition.');
    }
    const content = await this.files.getContent(
      organizationId,
      projectId,
      fileId,
      user.id,
    );
    if (requestedDisposition === 'inline' && !content.canPreview) {
      throw new BadRequestException('This file type cannot be previewed.');
    }

    response.setHeader('Content-Type', content.mimeType);
    response.setHeader('Content-Length', content.sizeBytes);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    response.setHeader(
      'Content-Disposition',
      formatContentDisposition(requestedDisposition, content.originalName),
    );
    response.send(content.buffer);
  }

  @Delete('files/:fileId')
  remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.files.remove(organizationId, projectId, fileId, user.id);
  }
}

function formatContentDisposition(
  disposition: 'attachment' | 'inline',
  originalName: string,
): string {
  const fallbackName =
    originalName.replace(/[^\x20-\x7e]|["\\;]/gu, '_') || 'download';
  const encodedName = encodeURIComponent(originalName).replace(
    /['()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}
