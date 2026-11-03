import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

const organizationId = 'c458281a-f25e-4be6-ae65-b16ee7bbd66c';
const projectId = '0b22efeb-7643-4fe2-9dc1-c952d47f0ff4';
const fileId = 'dbfc6f65-a333-4f4a-9c52-633065909d16';

const files = {
  listProjectFiles: vi.fn(),
  uploadProjectFile: vi.fn(),
  listTaskAttachments: vi.fn(),
  uploadTaskAttachment: vi.fn(),
  getContent: vi.fn(),
  remove: vi.fn(),
};

const authentication = {
  authenticate: vi.fn().mockResolvedValue({
    id: '4a42c365-ed61-4c80-a5a2-f3fcba6a71cb',
    name: 'Alex',
    email: 'alex@example.com',
    status: 'ACTIVE',
  }),
};

describe('FilesController HTTP authorization and streaming', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.clearAllMocks();
    authentication.authenticate.mockResolvedValue({
      id: '4a42c365-ed61-4c80-a5a2-f3fcba6a71cb',
      name: 'Alex',
      email: 'alex@example.com',
      status: 'ACTIVE',
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: authentication },
        { provide: FilesService, useValue: files },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('rejects unauthenticated downloads before file lookup or storage access', async () => {
    await request(app.getHttpServer())
      .get(
        `/organizations/${organizationId}/projects/${projectId}/files/${fileId}/content`,
      )
      .expect(401);
    expect(files.getContent).not.toHaveBeenCalled();
  });

  it('streams authorized content with private response headers', async () => {
    files.getContent.mockResolvedValue({
      stream: Readable.from(Buffer.from('safe')),
      mimeType: 'text/plain',
      sizeBytes: 4,
      originalName: 'notes.txt',
      canPreview: false,
    });

    const response = await request(app.getHttpServer())
      .get(
        `/organizations/${organizationId}/projects/${projectId}/files/${fileId}/content`,
      )
      .set('Authorization', 'Bearer valid-session')
      .expect(200);

    expect(response.text).toBe('safe');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain('notes.txt');
    expect(files.getContent).toHaveBeenCalledWith(
      organizationId,
      projectId,
      fileId,
      '4a42c365-ed61-4c80-a5a2-f3fcba6a71cb',
    );
  });

  it('returns a generic not-found response when authorized metadata is missing', async () => {
    files.getContent.mockRejectedValue(
      new NotFoundException('File not found.'),
    );
    await request(app.getHttpServer())
      .get(
        `/organizations/${organizationId}/projects/${projectId}/files/${fileId}/content`,
      )
      .set('Authorization', 'Bearer valid-session')
      .expect(404);
  });
});
