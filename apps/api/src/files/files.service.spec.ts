import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import {
  FILE_STORAGE_CONFIG,
  getFilesConfiguration,
  type FilesConfiguration,
} from './file-storage.config.js';
import {
  FILE_STORAGE_PROVIDER,
  type FileStorageProvider,
} from './file-storage.js';
import { FilesService } from './files.service.js';
import {
  MALWARE_SCANNER_PROVIDER,
  type MalwareScanner,
} from './malware-scanner.js';

const now = new Date('2026-11-02T18:00:00.000Z');
const organizationId = 'c458281a-f25e-4be6-ae65-b16ee7bbd66c';
const projectId = '0b22efeb-7643-4fe2-9dc1-c952d47f0ff4';
const taskId = '629f6c3e-3430-4bef-9bf0-3fc97daffc05';
const fileId = 'dbfc6f65-a333-4f4a-9c52-633065909d16';
const userId = '4a42c365-ed61-4c80-a5a2-f3fcba6a71cb';
const otherUserId = '5c40e197-0647-4e8d-a48a-87e4768f3179';
const storageKey = '1c2aebc8-06d3-4d34-aed9-2ca78f4a2e3b';

const transaction = {
  organizationMembership: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  projectMember: { findFirst: vi.fn() },
  task: { findFirst: vi.fn() },
  fileAttachment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};

const prisma = {
  $transaction: vi.fn(),
};

const storage = {
  putQuarantined: vi.fn(
    async (_storageKey: string, _content: Buffer, _mimeType: string) =>
      undefined,
  ),
  promoteQuarantined: vi.fn(async (_storageKey: string) => undefined),
  openActive: vi.fn(async (_storageKey: string) => ({
    stream: Readable.from(Buffer.from('safe')),
    sizeBytes: 4,
  })),
  remove: vi.fn(
    async (_storageKey: string, _area: 'active' | 'quarantine') => undefined,
  ),
  exists: vi.fn(async () => true),
  list: vi.fn(async () => ({ objects: [] })),
} satisfies FileStorageProvider;

const scanner = {
  scan: vi.fn<MalwareScanner['scan']>(async () => ({ status: 'clean' })),
} satisfies MalwareScanner;

const configuration: FilesConfiguration = {
  storage: { driver: 'local' },
  security: {
    scanRequired: false,
    scanner: { driver: 'none' },
    orphanMinimumAgeMs: 86_400_000,
  },
};

function makeFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: fileId,
    organizationId,
    projectId,
    uploadedById: userId,
    storageKey,
    originalName: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 4,
    scanStatus: 'CLEAN',
    createdAt: now,
    removedAt: null,
    uploaderMembership: { user: { name: 'Alex' } },
    taskAttachment: null,
    ...overrides,
  };
}

function textFile(originalname = 'notes.txt', content = Buffer.from('safe')) {
  return {
    originalname,
    mimetype: originalname.endsWith('.csv') ? 'text/csv' : 'text/plain',
    size: content.length,
    buffer: content,
  };
}

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'OWNER',
    });
    transaction.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    transaction.projectMember.findFirst.mockResolvedValue({ id: 'member' });
    transaction.task.findFirst.mockResolvedValue({ archivedAt: null });
    transaction.fileAttachment.findMany.mockResolvedValue([]);
    transaction.fileAttachment.findFirst.mockResolvedValue(makeFileRow());
    transaction.fileAttachment.create.mockResolvedValue(makeFileRow());
    transaction.fileAttachment.updateMany.mockResolvedValue({ count: 1 });
    transaction.auditLog.create.mockResolvedValue({ id: 'audit-id' });
    prisma.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    configuration.security.scanRequired = false;
    storage.putQuarantined.mockResolvedValue(undefined);
    storage.promoteQuarantined.mockResolvedValue(undefined);
    storage.openActive.mockResolvedValue({
      stream: Readable.from(Buffer.from('safe')),
      sizeBytes: 4,
    });
    storage.remove.mockResolvedValue(undefined);
    scanner.scan.mockResolvedValue({ status: 'clean' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: prisma },
        { provide: FILE_STORAGE_PROVIDER, useValue: storage },
        { provide: MALWARE_SCANNER_PROVIDER, useValue: scanner },
        { provide: FILE_STORAGE_CONFIG, useValue: configuration },
      ],
    }).compile();
    service = module.get(FilesService);
  });

  it('writes private bytes before transactionally creating metadata and an audit event', async () => {
    const operations: string[] = [];
    prisma.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) => {
        operations.push('transaction-start');
        const result = await operation(transaction);
        operations.push('transaction-end');
        return result;
      },
    );
    storage.putQuarantined.mockImplementation(async () => {
      operations.push('quarantine-write');
    });
    storage.promoteQuarantined.mockImplementation(async () => {
      operations.push('storage-promote');
    });

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).resolves.toMatchObject({
      id: fileId,
      originalName: 'notes.txt',
      mimeType: 'text/plain',
      uploaderName: 'Alex',
      canRemove: true,
    });

    expect(operations).toEqual([
      'transaction-start',
      'transaction-end',
      'quarantine-write',
      'storage-promote',
      'transaction-start',
      'transaction-end',
    ]);
    expect(transaction.fileAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId,
          projectId,
          uploadedById: userId,
          originalName: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 4,
          scanStatus: 'CLEAN',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId,
          actorId: userId,
          action: 'FILE_UPLOADED',
          targetType: 'FILE_ATTACHMENT',
          after: {
            mimeType: 'text/plain',
            sizeBytes: 4,
            scanStatus: 'CLEAN',
            taskId: null,
          },
        }),
      }),
    );
  });

  it('rejects invalid contents before touching storage or database', async () => {
    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, {
        originalname: 'image.png',
        mimetype: 'image/png',
        size: Buffer.from('not a png').length,
        buffer: Buffer.from('not a png'),
      }),
    ).rejects.toThrow('content does not match');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.putQuarantined).not.toHaveBeenCalled();
  });

  it('denies access to projects outside the user organization and membership scope', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.listProjectFiles(organizationId, projectId, userId, {
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.fileAttachment.findMany).not.toHaveBeenCalled();
  });

  it('requires the task to belong to the requested project before attaching a file', async () => {
    transaction.task.findFirst.mockResolvedValue(null);

    await expect(
      service.uploadTaskAttachment(
        organizationId,
        projectId,
        taskId,
        userId,
        textFile(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.putQuarantined).not.toHaveBeenCalled();
  });

  it('creates a tenant-constrained task association in the metadata transaction', async () => {
    transaction.fileAttachment.create.mockResolvedValue(
      makeFileRow({ taskAttachment: { taskId } }),
    );

    await expect(
      service.uploadTaskAttachment(
        organizationId,
        projectId,
        taskId,
        userId,
        textFile(),
      ),
    ).resolves.toMatchObject({ taskId });

    expect(transaction.fileAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId,
          projectId,
          taskAttachment: {
            create: { organizationId, projectId, taskId },
          },
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: {
            mimeType: 'text/plain',
            sizeBytes: 4,
            scanStatus: 'CLEAN',
            taskId,
          },
        }),
      }),
    );
  });

  it('does not expose project files to an unassigned organization member', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.listProjectFiles(organizationId, projectId, userId, {
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.fileAttachment.findMany).not.toHaveBeenCalled();
  });

  it('does not persist metadata when private storage rejects an upload', async () => {
    storage.putQuarantined.mockRejectedValue(new Error('private path detail'));

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('File storage is unavailable.');
    expect(transaction.fileAttachment.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not read file bytes when project access is unauthorized', async () => {
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.getContent(organizationId, projectId, fileId, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.openActive).not.toHaveBeenCalled();
  });

  it('limits file removal to its uploader or a project manager', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.fileAttachment.findFirst.mockResolvedValue(
      makeFileRow({ uploadedById: otherUserId }),
    );

    await expect(
      service.remove(organizationId, projectId, fileId, userId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.fileAttachment.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('records a removal audit event and deletes private bytes after commit', async () => {
    await expect(
      service.remove(organizationId, projectId, fileId, userId),
    ).resolves.toBeUndefined();

    expect(transaction.fileAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: fileId, organizationId, projectId, removedAt: null },
      data: { removedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: userId,
          action: 'FILE_REMOVED',
          targetId: fileId,
        }),
      }),
    );
    expect(storage.remove).toHaveBeenCalledWith(storageKey, 'active');
  });

  it('reports a retryable failure and preserves removal metadata when storage deletion fails', async () => {
    storage.remove.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      service.remove(organizationId, projectId, fileId, userId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(transaction.fileAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: fileId, organizationId, projectId, removedAt: null },
      data: { removedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(storageKey, 'active');
  });

  it('retries a failed deletion for an already removed file without duplicating its audit event', async () => {
    storage.remove.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      service.remove(organizationId, projectId, fileId, userId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    transaction.fileAttachment.findFirst.mockResolvedValue(
      makeFileRow({ removedAt: new Date('2026-11-02T18:00:00.000Z') }),
    );
    await expect(
      service.remove(organizationId, projectId, fileId, userId),
    ).resolves.toBeUndefined();

    expect(transaction.fileAttachment.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenLastCalledWith(storageKey, 'active');
  });

  it('cleans up stored bytes when metadata or audit persistence fails', async () => {
    transaction.auditLog.create.mockRejectedValue(
      new Error('database failure'),
    );

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('database failure');
    expect(storage.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
      'active',
    );
  });

  it('serves validated content only after metadata lookup and access checks', async () => {
    await expect(
      service.getContent(organizationId, projectId, fileId, userId),
    ).resolves.toMatchObject({
      mimeType: 'text/plain',
      sizeBytes: 4,
      canPreview: false,
    });
    expect(storage.openActive).toHaveBeenCalledWith(storageKey);
  });

  it('does not disclose storage details when reading fails', async () => {
    storage.openActive.mockRejectedValue(new Error('private path detail'));

    await expect(
      service.getContent(organizationId, projectId, fileId, userId),
    ).rejects.toThrow('File content is unavailable.');
  });

  it('rejects infected quarantined content and never promotes or persists it', async () => {
    scanner.scan.mockResolvedValue({ status: 'infected' });

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('failed its security scan');

    expect(storage.promoteQuarantined).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(
      expect.any(String),
      'quarantine',
    );
    expect(transaction.fileAttachment.create).not.toHaveBeenCalled();
  });

  it('fails safely when scanning is required but unavailable', async () => {
    configuration.security.scanRequired = true;
    scanner.scan.mockResolvedValue({ status: 'unavailable' });

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('security scanning is temporarily unavailable');

    expect(storage.promoteQuarantined).not.toHaveBeenCalled();
    expect(transaction.fileAttachment.create).not.toHaveBeenCalled();
  });

  it('fails safely when the configured production scanner throws', async () => {
    configuration.security.scanRequired = getFilesConfiguration({
      NODE_ENV: 'production',
      FILE_STORAGE_DRIVER: 's3',
      FILE_S3_BUCKET: 'private-nexus-files',
      FILE_S3_REGION: 'eu-west-1',
    }).security.scanRequired;
    scanner.scan.mockRejectedValue(new Error('scanner connection failed'));

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('security scanning is temporarily unavailable');

    expect(storage.promoteQuarantined).not.toHaveBeenCalled();
    expect(transaction.fileAttachment.create).not.toHaveBeenCalled();
  });

  it('returns not found for a missing private object without exposing provider details', async () => {
    storage.openActive.mockRejectedValue(
      Object.assign(new Error('NoSuchKey private bucket detail'), {
        code: 'ENOENT',
      }),
    );

    await expect(
      service.getContent(organizationId, projectId, fileId, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks attempts to download unscanned files under production policy', async () => {
    configuration.security.scanRequired = getFilesConfiguration({
      NODE_ENV: 'production',
      FILE_STORAGE_DRIVER: 's3',
      FILE_S3_BUCKET: 'private-nexus-files',
      FILE_S3_REGION: 'eu-west-1',
    }).security.scanRequired;
    transaction.fileAttachment.findFirst.mockResolvedValue(
      makeFileRow({ scanStatus: 'UNSCANNED' }),
    );

    await expect(
      service.getContent(organizationId, projectId, fileId, userId),
    ).rejects.toThrow('security verification is required');
    expect(storage.openActive).not.toHaveBeenCalled();
  });

  it('does not persist an unscanned upload when production scanner configuration is missing', async () => {
    const productionConfiguration = getFilesConfiguration({
      NODE_ENV: 'production',
      FILE_STORAGE_DRIVER: 's3',
      FILE_S3_BUCKET: 'private-nexus-files',
      FILE_S3_REGION: 'eu-west-1',
    });
    configuration.security.scanRequired =
      productionConfiguration.security.scanRequired;
    scanner.scan.mockResolvedValue({ status: 'unavailable' });

    await expect(
      service.uploadProjectFile(organizationId, projectId, userId, textFile()),
    ).rejects.toThrow('security scanning is temporarily unavailable');

    expect(productionConfiguration.security.scanner).toEqual({
      driver: 'none',
    });
    expect(storage.promoteQuarantined).not.toHaveBeenCalled();
    expect(transaction.fileAttachment.create).not.toHaveBeenCalled();
  });
});
