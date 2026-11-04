import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { PrismaService } from '../prisma.service.js';
import { FilesController } from './files.controller.js';
import { getFilesConfiguration } from './file-storage.config.js';
import { FILE_STORAGE_PROVIDER } from './file-storage.js';
import { FilesService } from './files.service.js';
import { OrganizationFilesController } from './organization-files.controller.js';
import { ClamAvMalwareScanner } from './clamav-malware-scanner.js';
import { S3FileStorageProvider } from './s3-file-storage.js';
import type { FileStorageProvider } from './file-storage.js';
import {
  MALWARE_SCANNER_PROVIDER,
  type MalwareScanner,
} from './malware-scanner.js';

const enabled = process.env.NEXUS_FILE_STORAGE_E2E === 'true';
const testRunId = randomUUID();
const allowedDatabaseName = 'nexus_file_e2e';
const authorization = 'Bearer file-storage-e2e-token';
const expectedEicar =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe.skipIf(!enabled)(
  'File management integration (isolated PostgreSQL, RustFS, ClamAV)',
  () => {
    let app: INestApplication<App>;
    let database: PrismaService;
    let storage: FileStorageProvider;
    let scanner: MalwareScanner;
    let user: AuthenticatedUser;
    let organizationId: string;
    let projectId: string;
    let taskId: string;
    let otherProjectId: string;
    let otherTaskId: string;
    let otherOrganizationId: string;
    let otherOrganizationProjectId: string;
    let otherUserId: string;
    let recordsSeeded = false;
    let heldScan: {
      signalEntered: () => void;
      wait: Promise<void>;
    } | null = null;
    let failNextActiveRemove = false;

    beforeAll(async () => {
      const databaseUrl = required('NEXUS_FILE_E2E_DATABASE_URL');
      assertSafeDatabaseUrl(databaseUrl);
      const originalDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      try {
        database = new PrismaService();
        await database.$connect();
      } finally {
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }

      const filesConfiguration = getFilesConfiguration({
        ...process.env,
        NODE_ENV: 'test',
        FILE_STORAGE_DRIVER: 's3',
        FILE_MALWARE_SCAN_REQUIRED: 'true',
        FILE_MALWARE_SCANNER_DRIVER: 'clamav',
      });
      if (filesConfiguration.storage.driver !== 's3') {
        throw new Error('The file integration test requires S3 storage.');
      }
      if (filesConfiguration.security.scanner.driver !== 'clamav') {
        throw new Error('The file integration test requires ClamAV.');
      }
      if (
        !filesConfiguration.storage.endpoint ||
        !isLoopbackUrl(filesConfiguration.storage.endpoint) ||
        !filesConfiguration.storage.forcePathStyle
      ) {
        throw new Error(
          'The file integration test requires path-style RustFS on a loopback endpoint.',
        );
      }
      if (
        !['localhost', '127.0.0.1', '::1'].includes(
          filesConfiguration.security.scanner.host.toLowerCase(),
        )
      ) {
        throw new Error(
          'The file integration test only connects to loopback ClamAV.',
        );
      }
      const s3Storage = new S3FileStorageProvider({
        ...filesConfiguration.storage,
        prefix: `${filesConfiguration.storage.prefix}/e2e/${testRunId}`,
      });
      storage = {
        putQuarantined: (...args) => s3Storage.putQuarantined(...args),
        promoteQuarantined: (...args) => s3Storage.promoteQuarantined(...args),
        openActive: (...args) => s3Storage.openActive(...args),
        remove: async (key, area) => {
          if (failNextActiveRemove && area === 'active') {
            failNextActiveRemove = false;
            throw new Error('injected transient deletion failure');
          }
          await s3Storage.remove(key, area);
        },
        exists: (...args) => s3Storage.exists(...args),
        list: (...args) => s3Storage.list(...args),
      };

      const realScanner = new ClamAvMalwareScanner(
        filesConfiguration.security.scanner,
      );
      scanner = {
        scan: async (input) => {
          if (heldScan) {
            const current = heldScan;
            current.signalEntered();
            await current.wait;
            heldScan = null;
          }
          return realScanner.scan(input);
        },
      };

      const bucket = filesConfiguration.storage.bucket;
      const endpoint = filesConfiguration.storage.endpoint;
      const probeKey = randomUUID();
      try {
        const anonymousBucketAccess = await fetch(
          `${endpoint}/${encodeURIComponent(bucket)}/`,
        );
        if (anonymousBucketAccess.status !== 403) {
          throw new Error('RustFS bucket is not private.');
        }
        await storage.putQuarantined(
          probeKey,
          Buffer.from('NEXUS storage e2e readiness probe'),
          'text/plain',
        );
        if (!(await storage.exists(probeKey, 'quarantine'))) {
          throw new Error('RustFS quarantine readiness probe failed.');
        }
        await storage.remove(probeKey, 'quarantine');
        const clamavResult = await realScanner.scan({
          content: Buffer.from('NEXUS ClamAV readiness probe'),
          mimeType: 'text/plain',
          originalName: 'readiness.txt',
          storageKey: randomUUID(),
        });
        if (clamavResult.status !== 'clean') {
          throw new Error('ClamAV did not return a clean readiness verdict.');
        }
      } catch {
        throw new Error(
          `File e2e prerequisites are unavailable (bucket ${bucket}, endpoint ${endpoint}).`,
        );
      }

      user = {
        id: randomUUID(),
        name: `File e2e ${testRunId}`,
        email: `file-e2e-${testRunId}@example.test`,
        status: 'ACTIVE',
      };
      otherUserId = randomUUID();
      organizationId = randomUUID();
      projectId = randomUUID();
      taskId = randomUUID();
      otherProjectId = randomUUID();
      otherTaskId = randomUUID();
      otherOrganizationId = randomUUID();
      otherOrganizationProjectId = randomUUID();

      await seedRecords();
      recordsSeeded = true;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [FilesController, OrganizationFilesController],
        providers: [
          FilesService,
          ClerkAuthGuard,
          { provide: PrismaService, useValue: database },
          {
            provide: ClerkAuthService,
            useValue: { authenticate: async () => user },
          },
          { provide: FILE_STORAGE_PROVIDER, useValue: storage },
          { provide: MALWARE_SCANNER_PROVIDER, useValue: scanner },
        ],
      }).compile();
      const maxUploadBytes = process.env.FILE_MAX_UPLOAD_BYTES;
      process.env.FILE_MAX_UPLOAD_BYTES = String(10 * 1024 * 1024);
      try {
        app = module.createNestApplication();
        await app.init();
      } finally {
        if (maxUploadBytes === undefined) {
          delete process.env.FILE_MAX_UPLOAD_BYTES;
        } else {
          process.env.FILE_MAX_UPLOAD_BYTES = maxUploadBytes;
        }
      }
    }, 60_000);

    afterAll(async () => {
      if (app) await app.close();
      if (database) {
        if (recordsSeeded) await cleanupRecordsAndObjects();
        await database.$disconnect();
      }
    }, 60_000);

    it('uploads through authenticated API, scans with ClamAV, promotes and records metadata/audit', async () => {
      const content = Buffer.from('private clean file from integration test');
      const response = await uploadProjectFile(
        content,
        'verified.txt',
        'text/plain',
      ).expect(201);
      expect(response.body).toMatchObject({
        originalName: 'verified.txt',
        mimeType: 'text/plain',
        sizeBytes: content.length,
        scanStatus: 'CLEAN',
        canPreview: false,
      });
      expect(JSON.stringify(response.body)).not.toContain('storageKey');

      const row = await database.fileAttachment.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(row).toMatchObject({
        organizationId,
        projectId,
        uploadedById: user.id,
        originalName: 'verified.txt',
        scanStatus: 'CLEAN',
      });
      expect(await storage.exists(row.storageKey, 'active')).toBe(true);
      expect(await storage.exists(row.storageKey, 'quarantine')).toBe(false);

      const audit = await database.auditLog.findFirst({
        where: {
          organizationId,
          targetId: row.id,
          action: 'FILE_UPLOADED',
        },
      });
      expect(audit?.after).toMatchObject({
        scanStatus: 'CLEAN',
        taskId: null,
      });
    });

    it('uploads a task attachment with tenant-scoped relation and previews clean images', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const upload = await request(app.getHttpServer())
        .post(taskAttachmentsPath())
        .set('Authorization', authorization)
        .attach('file', png, {
          filename: 'task-preview.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(upload.body).toMatchObject({
        taskId,
        scanStatus: 'CLEAN',
        canPreview: true,
      });

      const association = await database.taskFileAttachment.findUnique({
        where: {
          organizationId_projectId_fileId: {
            organizationId,
            projectId,
            fileId: upload.body.id,
          },
        },
      });
      expect(association?.taskId).toBe(taskId);

      const preview = await request(app.getHttpServer())
        .get(fileContentPath(upload.body.id))
        .query({ disposition: 'inline' })
        .set('Authorization', authorization)
        .expect(200);
      expect(preview.headers['content-type']).toContain('image/png');
      expect(Buffer.from(preview.body)).toEqual(png);
      expect(preview.headers['cache-control']).toBe('private, no-store');
    });

    it('keeps content in quarantine and unlisted while the real scan is pending', async () => {
      let markEntered!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldScan = {
        signalEntered: markEntered,
        wait: gate,
      };
      const pendingUpload = uploadProjectFile(
        Buffer.from('pending file content'),
        'pending.txt',
        'text/plain',
      ).then((response) => response);

      let completed: Awaited<typeof pendingUpload>;
      try {
        await Promise.race([
          entered,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Upload did not enter the scanner.')),
              10_000,
            ),
          ),
        ]);
        const quarantined = await storage.list('quarantine', { limit: 100 });
        expect(quarantined.objects.length).toBeGreaterThan(0);
        for (const object of quarantined.objects) {
          expect(await storage.exists(object.storageKey, 'active')).toBe(false);
        }
        const visible = await request(app.getHttpServer())
          .get(projectFilesPath())
          .set('Authorization', authorization)
          .expect(200);
        expect(
          visible.body.items.some(
            (item: { originalName: string }) =>
              item.originalName === 'pending.txt',
          ),
        ).toBe(false);
        expect(
          await database.fileAttachment.count({
            where: { organizationId, projectId, originalName: 'pending.txt' },
          }),
        ).toBe(0);
      } finally {
        release();
      }
      completed = await pendingUpload;
      expect(completed.status).toBe(201);
      expect(completed.body.scanStatus).toBe('CLEAN');
    }, 30_000);

    it('rejects EICAR through actual ClamAV without metadata or active object', async () => {
      const before = await storage.list('active', { limit: 100 });
      const response = await uploadProjectFile(
        Buffer.from(expectedEicar),
        'scanner-test.txt',
        'text/plain',
      ).expect(400);
      expect(response.body.message).toContain('security scan');

      const after = await storage.list('active', { limit: 100 });
      expect(after.objects).toEqual(before.objects);
      expect(
        await database.fileAttachment.count({
          where: {
            organizationId,
            projectId,
            originalName: 'scanner-test.txt',
          },
        }),
      ).toBe(0);
    });

    it('rejects invalid file types and files above the default upload limit', async () => {
      await uploadProjectFile(
        Buffer.from('not allowed'),
        'bad.exe',
        'text/plain',
      ).expect(400);

      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
      await uploadProjectFile(oversized, 'large.txt', 'text/plain').expect(400);
      expect(
        await database.fileAttachment.count({
          where: {
            organizationId,
            projectId,
            originalName: { in: ['bad.exe', 'large.txt'] },
          },
        }),
      ).toBe(0);
    }, 30_000);

    it('denies cross-project, cross-organization, and wrong-project task access', async () => {
      const file = await database.fileAttachment.findFirstOrThrow({
        where: { organizationId, projectId, removedAt: null },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .get(fileContentPath(file.id, otherProjectId))
        .set('Authorization', authorization)
        .expect(404);
      await request(app.getHttpServer())
        .get(
          `/organizations/${otherOrganizationId}/projects/${otherOrganizationProjectId}/files/${file.id}/content`,
        )
        .set('Authorization', authorization)
        .expect(404);
      await request(app.getHttpServer())
        .get(taskAttachmentsPath(otherTaskId))
        .set('Authorization', authorization)
        .expect(404);
      await request(app.getHttpServer())
        .post(taskAttachmentsPath(otherTaskId))
        .set('Authorization', authorization)
        .attach('file', Buffer.from('wrong task'), {
          filename: 'wrong-task.txt',
          contentType: 'text/plain',
        })
        .expect(404);
      expect(
        await database.fileAttachment.count({
          where: { organizationId, projectId, originalName: 'wrong-task.txt' },
        }),
      ).toBe(0);
    });

    it('blocks legacy UNSCANNED records and quarantined-only objects from download and preview', async () => {
      const id = randomUUID();
      const key = randomUUID();
      await storage.putQuarantined(
        key,
        Buffer.from('not promoted'),
        'image/png',
      );
      await database.fileAttachment.create({
        data: {
          id,
          organizationId,
          projectId,
          uploadedById: user.id,
          storageKey: key,
          originalName: 'legacy-unscanned.png',
          mimeType: 'image/png',
          sizeBytes: 12,
          scanStatus: 'UNSCANNED',
        },
      });

      const listed = await request(app.getHttpServer())
        .get(projectFilesPath())
        .set('Authorization', authorization)
        .expect(200);
      expect(
        listed.body.items.find((item: { id: string }) => item.id === id),
      ).toMatchObject({ scanStatus: 'UNSCANNED', canPreview: false });

      await request(app.getHttpServer())
        .get(fileContentPath(id))
        .set('Authorization', authorization)
        .expect(503);
      await request(app.getHttpServer())
        .get(fileContentPath(id))
        .query({ disposition: 'inline' })
        .set('Authorization', authorization)
        .expect(503);
      expect(await storage.exists(key, 'active')).toBe(false);
      expect(await storage.exists(key, 'quarantine')).toBe(true);
    });

    it('removes stored object and retains retryable metadata/audit on a transient delete failure', async () => {
      const upload = await uploadProjectFile(
        Buffer.from('retryable remove'),
        'retry-delete.txt',
        'text/plain',
      ).expect(201);
      const row = await database.fileAttachment.findUniqueOrThrow({
        where: { id: upload.body.id },
      });

      failNextActiveRemove = true;
      await request(app.getHttpServer())
        .delete(filePath(upload.body.id))
        .set('Authorization', authorization)
        .expect(503);
      const removedRow = await database.fileAttachment.findUniqueOrThrow({
        where: { id: upload.body.id },
      });
      expect(removedRow.removedAt).toBeInstanceOf(Date);
      expect(await storage.exists(row.storageKey, 'active')).toBe(true);

      await request(app.getHttpServer())
        .delete(filePath(upload.body.id))
        .set('Authorization', authorization)
        .expect(200);
      expect(await storage.exists(row.storageKey, 'active')).toBe(false);

      const removalEvents = await database.auditLog.count({
        where: {
          organizationId,
          targetId: upload.body.id,
          action: 'FILE_REMOVED',
        },
      });
      expect(removalEvents).toBe(1);
    });

    it('does not expose missing or arbitrary object identifiers', async () => {
      await request(app.getHttpServer())
        .get(fileContentPath(randomUUID()))
        .set('Authorization', authorization)
        .expect(404);
      await request(app.getHttpServer())
        .get(
          `/organizations/${organizationId}/projects/${projectId}/files/${encodeURIComponent('../active/object')}/content`,
        )
        .set('Authorization', authorization)
        .expect((response) => {
          expect([400, 404]).toContain(response.status);
        });
    });

    async function seedRecords(): Promise<void> {
      await database.$transaction(async (transaction) => {
        await transaction.user.createMany({
          data: [
            {
              id: user.id,
              name: user.name,
              email: user.email,
            },
            {
              id: otherUserId,
              name: 'Other test member',
              email: `file-e2e-other-${testRunId}@example.test`,
            },
          ],
        });
        await transaction.organization.createMany({
          data: [
            {
              id: organizationId,
              name: `File e2e ${testRunId}`,
              slug: `file-e2e-${testRunId}`,
            },
            {
              id: otherOrganizationId,
              name: `File e2e other ${testRunId}`,
              slug: `file-e2e-other-${testRunId}`,
            },
          ],
        });
        await transaction.organizationMembership.createMany({
          data: [
            { organizationId, userId: user.id, role: 'MEMBER' },
            { organizationId, userId: otherUserId, role: 'MEMBER' },
            {
              organizationId: otherOrganizationId,
              userId: otherUserId,
              role: 'MEMBER',
            },
          ],
        });
        await transaction.project.createMany({
          data: [
            { id: projectId, organizationId, name: 'E2E authorized project' },
            { id: otherProjectId, organizationId, name: 'E2E other project' },
            {
              id: otherOrganizationProjectId,
              organizationId: otherOrganizationId,
              name: 'E2E other organization project',
            },
          ],
        });
        await transaction.projectMember.createMany({
          data: [
            { organizationId, projectId, userId: user.id },
            {
              organizationId,
              projectId: otherProjectId,
              userId: otherUserId,
            },
            {
              organizationId: otherOrganizationId,
              projectId: otherOrganizationProjectId,
              userId: otherUserId,
            },
          ],
        });
        await transaction.task.createMany({
          data: [
            {
              id: taskId,
              organizationId,
              projectId,
              creatorId: user.id,
              title: 'E2E authorized task',
            },
            {
              id: otherTaskId,
              organizationId,
              projectId: otherProjectId,
              creatorId: otherUserId,
              title: 'E2E unauthorized task',
            },
          ],
        });
      });
    }

    async function cleanupRecordsAndObjects(): Promise<void> {
      if (storage) {
        const records = await database.fileAttachment.findMany({
          where: { organizationId },
          select: { id: true, storageKey: true },
        });
        for (const record of records) {
          for (const area of ['active', 'quarantine'] as const) {
            await storage.remove(record.storageKey, area);
          }
        }

        for (const area of ['active', 'quarantine'] as const) {
          const objects = await storage.list(area, { limit: 1000 });
          for (const object of objects.objects) {
            await storage.remove(object.storageKey, area);
          }
        }
      }

      await database.$transaction(async (transaction) => {
        await transaction.auditLog.deleteMany({
          where: {
            organizationId: { in: [organizationId, otherOrganizationId] },
          },
        });
        await transaction.taskFileAttachment.deleteMany({
          where: { organizationId },
        });
        await transaction.fileAttachment.deleteMany({
          where: { organizationId },
        });
        await transaction.task.deleteMany({
          where: {
            id: { in: [taskId, otherTaskId] },
          },
        });
        await transaction.projectMember.deleteMany({
          where: {
            organizationId: { in: [organizationId, otherOrganizationId] },
          },
        });
        await transaction.project.deleteMany({
          where: {
            id: {
              in: [projectId, otherProjectId, otherOrganizationProjectId],
            },
          },
        });
        await transaction.organizationMembership.deleteMany({
          where: {
            userId: { in: [user.id, otherUserId] },
            organizationId: { in: [organizationId, otherOrganizationId] },
          },
        });
        await transaction.organization.deleteMany({
          where: { id: { in: [organizationId, otherOrganizationId] } },
        });
        await transaction.user.deleteMany({
          where: { id: { in: [user.id, otherUserId] } },
        });
      });
    }

    function uploadProjectFile(
      content: Buffer,
      filename: string,
      contentType: string,
    ) {
      return request(app.getHttpServer())
        .post(projectFilesPath())
        .set('Authorization', authorization)
        .attach('file', content, { filename, contentType });
    }

    function projectFilesPath(project = projectId): string {
      return `/organizations/${organizationId}/projects/${project}/files`;
    }

    function taskAttachmentsPath(task = taskId, project = projectId): string {
      return `${projectFilesPath(project)}/tasks/${task}/attachments`;
    }

    function filePath(
      file: string = randomUUID(),
      project: string = projectId,
    ): string {
      return `${projectFilesPath(project)}/${file}`;
    }

    function fileContentPath(
      file: string = randomUUID(),
      project: string = projectId,
    ): string {
      return `${filePath(file, project)}/content`;
    }
  },
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. File e2e tests never load local .env files.`,
    );
  }
  return value;
}

function assertSafeDatabaseUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/u, ''));
  if (
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()) ||
    databaseName !== allowedDatabaseName
  ) {
    throw new Error(
      `File e2e tests require a loopback PostgreSQL database named ${allowedDatabaseName}.`,
    );
  }
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
