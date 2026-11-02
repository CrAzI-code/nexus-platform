import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationRole } from '../generated/prisma/client.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { PrismaService } from '../prisma.service.js';
import {
  FILE_STORAGE_PROVIDER,
  type FileStorageProvider,
} from './file-storage.js';
import {
  getMaximumFileUploadSize,
  supportsInlinePreview,
  validateFileUpload,
  type UploadFileData,
} from './file-validation.js';
import type { FileListQuery } from './files.dto.js';

type Transaction = Prisma.TransactionClient;

const fileSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  uploadedById: true,
  storageKey: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  removedAt: true,
  uploaderMembership: {
    select: { user: { select: { name: true } } },
  },
  taskAttachment: { select: { taskId: true } },
} satisfies Prisma.FileAttachmentSelect;

type FileRecord = Prisma.FileAttachmentGetPayload<{
  select: typeof fileSelect;
}>;

interface ProjectAccess {
  role: OrganizationRole;
  projectStatus: 'ACTIVE' | 'ARCHIVED';
}

export interface FileAttachmentResponse {
  id: string;
  projectId: string;
  taskId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploaderName: string;
  canPreview: boolean;
  canRemove: boolean;
}

export interface FileAttachmentPage {
  items: FileAttachmentResponse[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  canUpload: boolean;
}

export interface FileContent {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  canPreview: boolean;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly maxUploadBytes = getMaximumFileUploadSize();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_PROVIDER)
    private readonly storage: FileStorageProvider,
  ) {}

  listProjectFiles(
    organizationId: string,
    projectId: string,
    userId: string,
    query: FileListQuery,
  ): Promise<FileAttachmentPage> {
    return this.listFiles(organizationId, projectId, undefined, userId, query);
  }

  listTaskAttachments(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    query: FileListQuery,
  ): Promise<FileAttachmentPage> {
    return this.listFiles(organizationId, projectId, taskId, userId, query);
  }

  async uploadProjectFile(
    organizationId: string,
    projectId: string,
    userId: string,
    file: UploadFileData,
  ): Promise<FileAttachmentResponse> {
    return this.upload(
      organizationId,
      projectId,
      undefined,
      userId,
      file,
    );
  }

  async uploadTaskAttachment(
    organizationId: string,
    projectId: string,
    taskId: string,
    userId: string,
    file: UploadFileData,
  ): Promise<FileAttachmentResponse> {
    return this.upload(organizationId, projectId, taskId, userId, file);
  }

  async getContent(
    organizationId: string,
    projectId: string,
    fileId: string,
    userId: string,
  ): Promise<FileContent> {
    const file = await this.prisma.$transaction(async (transaction) => {
      await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      return this.findActiveFile(transaction, organizationId, projectId, fileId);
    });

    let buffer: Buffer;
    try {
      buffer = await this.storage.read(file.storageKey);
    } catch (error) {
      this.logStorageFailure('read', error);
      if (hasErrorCode(error, 'ENOENT')) {
        throw new NotFoundException('File not found.');
      }
      throw new InternalServerErrorException('File content is unavailable.');
    }

    if (
      buffer.length !== file.sizeBytes ||
      !this.hasStoredContentSignature(file.mimeType, buffer)
    ) {
      this.logger.warn(
        JSON.stringify({ event: 'stored_file_integrity_check_failed' }),
      );
      throw new NotFoundException('File not found.');
    }

    return {
      buffer,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      originalName: file.originalName,
      canPreview: supportsInlinePreview(file.mimeType),
    };
  }

  async remove(
    organizationId: string,
    projectId: string,
    fileId: string,
    userId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      const file = await transaction.fileAttachment.findFirst({
        where: {
          id: fileId,
          organizationId,
          projectId,
          removedAt: null,
        },
        select: fileSelect,
      });
      if (!file) throw new NotFoundException('File not found.');
      this.assertCanRemove(file, access.role, userId);

      const removedAt = new Date();
      const update = await transaction.fileAttachment.updateMany({
        where: {
          id: fileId,
          organizationId,
          projectId,
          removedAt: null,
        },
        data: { removedAt },
      });
      if (update.count !== 1) throw new ConflictException('File was already removed.');

      await AuditLogsService.record(transaction, {
        organizationId,
        actorId: userId,
        action: 'FILE_REMOVED',
        targetType: 'FILE_ATTACHMENT',
        targetId: file.id,
        before: {
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          taskId: file.taskAttachment?.taskId ?? null,
        },
        after: { removed: true },
      });

      return file.storageKey;
    });

    try {
      await this.storage.remove(storageKey);
    } catch (error) {
      this.logStorageFailure('remove', error);
    }
  }

  private async listFiles(
    organizationId: string,
    projectId: string,
    taskId: string | undefined,
    userId: string,
    query: FileListQuery,
  ): Promise<FileAttachmentPage> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      let canUpload = access.projectStatus === 'ACTIVE';
      if (taskId) {
        const task = await this.requireTask(
          transaction,
          organizationId,
          projectId,
          taskId,
        );
        canUpload = canUpload && task.archivedAt === null;
      }

      const rows = await transaction.fileAttachment.findMany({
        where: {
          organizationId,
          projectId,
          removedAt: null,
          ...(taskId
            ? { taskAttachment: { is: { taskId } } }
            : {}),
        },
        select: fileSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      return {
        items: rows
          .slice(0, query.pageSize)
          .map((file) => this.toResponse(file, access.role, userId)),
        page: query.page,
        pageSize: query.pageSize,
        hasMore,
        canUpload,
      };
    });
  }

  private async upload(
    organizationId: string,
    projectId: string,
    taskId: string | undefined,
    userId: string,
    untrustedFile: UploadFileData,
  ): Promise<FileAttachmentResponse> {
    const file = validateFileUpload(untrustedFile, this.maxUploadBytes);
    await this.prisma.$transaction(async (transaction) => {
      const access = await this.requireProjectAccess(
        transaction,
        organizationId,
        projectId,
        userId,
      );
      this.assertProjectCanChange(access);
      if (taskId) {
        const task = await this.requireTask(
          transaction,
          organizationId,
          projectId,
          taskId,
        );
        if (task.archivedAt) {
          throw new ConflictException(
            'Attachments cannot be added to archived tasks.',
          );
        }
      }
    });

    const storageKey = randomUUID();
    try {
      await this.storage.write(storageKey, file.buffer);
    } catch (error) {
      this.logStorageFailure('write', error);
      throw new InternalServerErrorException('File storage is unavailable.');
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const access = await this.requireProjectAccess(
          transaction,
          organizationId,
          projectId,
          userId,
        );
        this.assertProjectCanChange(access);
        if (taskId) {
          const task = await this.requireTask(
            transaction,
            organizationId,
            projectId,
            taskId,
          );
          if (task.archivedAt) {
            throw new ConflictException(
              'Attachments cannot be added to archived tasks.',
            );
          }
        }

        const created = await transaction.fileAttachment.create({
          data: {
            organizationId,
            projectId,
            uploadedById: userId,
            storageKey,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            ...(taskId
              ? {
                  taskAttachment: {
                    create: { organizationId, projectId, taskId },
                  },
                }
              : {}),
          },
          select: fileSelect,
        });
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: userId,
          action: 'FILE_UPLOADED',
          targetType: 'FILE_ATTACHMENT',
          targetId: created.id,
          after: {
            mimeType: created.mimeType,
            sizeBytes: created.sizeBytes,
            taskId: created.taskAttachment?.taskId ?? null,
          },
        });
        return this.toResponse(created, access.role, userId);
      });
    } catch (error) {
      try {
        await this.storage.remove(storageKey);
      } catch (cleanupError) {
        this.logStorageFailure('upload_rollback', cleanupError);
      }
      throw error;
    }
  }

  private async requireProjectAccess(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectAccess> {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Project not found.');

    const project = await transaction.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        ...(membership.role === 'OWNER' || membership.role === 'ADMIN'
          ? {}
          : {
              members: {
                some: {
                  userId,
                  status: 'ACTIVE',
                  membership: { status: 'ACTIVE' },
                },
              },
            }),
      },
      select: { status: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    return { role: membership.role, projectStatus: project.status };
  }

  private async requireTask(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<{ archivedAt: Date | null }> {
    const task = await transaction.task.findFirst({
      where: { id: taskId, organizationId, projectId },
      select: { archivedAt: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async findActiveFile(
    transaction: Transaction,
    organizationId: string,
    projectId: string,
    fileId: string,
  ): Promise<FileRecord> {
    const file = await transaction.fileAttachment.findFirst({
      where: {
        id: fileId,
        organizationId,
        projectId,
        removedAt: null,
      },
      select: fileSelect,
    });
    if (!file) throw new NotFoundException('File not found.');
    return file;
  }

  private assertCanRemove(
    file: FileRecord,
    role: OrganizationRole,
    userId: string,
  ): void {
    if (
      file.uploadedById !== userId &&
      role !== 'OWNER' &&
      role !== 'ADMIN' &&
      role !== 'MANAGER'
    ) {
      throw new ForbiddenException(
        'Only the uploader or an Owner, Admin, or project Manager can remove this file.',
      );
    }
  }

  private assertProjectCanChange(access: ProjectAccess): void {
    if (access.projectStatus !== 'ACTIVE') {
      throw new ConflictException('Archived projects cannot change files.');
    }
  }

  private toResponse(
    file: FileRecord,
    role: OrganizationRole,
    userId: string,
  ): FileAttachmentResponse {
    return {
      id: file.id,
      projectId: file.projectId,
      taskId: file.taskAttachment?.taskId ?? null,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedAt: file.createdAt,
      uploaderName: file.uploaderMembership.user.name,
      canPreview: supportsInlinePreview(file.mimeType),
      canRemove:
        file.uploadedById === userId ||
        role === 'OWNER' ||
        role === 'ADMIN' ||
        role === 'MANAGER',
    };
  }

  private hasStoredContentSignature(mimeType: string, buffer: Buffer): boolean {
    try {
      validateFileUpload(
        {
          originalname: `stored${extensionForMimeType(mimeType)}`,
          mimetype: mimeType,
          size: buffer.length,
          buffer,
        },
        this.maxUploadBytes,
      );
      return true;
    } catch {
      return false;
    }
  }

  private logStorageFailure(operation: string, error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'private_file_storage_failure',
        operation,
        errorCode: safeErrorCode(error),
      }),
    );
  }
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return '.pdf';
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'text/plain':
      return '.txt';
    case 'text/csv':
      return '.csv';
    default:
      return '';
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]+$/.test(error.code)
  ) {
    return error.code;
  }
  return 'unknown';
}
