import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';

describe('AuditLogsController', () => {
  let app: INestApplication<App>;
  const auth = { authenticate: vi.fn() };
  const auditLogs = { list: vi.fn() };

  beforeEach(async () => {
    auth.authenticate.mockReset();
    auditLogs.list.mockReset();
    auditLogs.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      hasMore: false,
    });
    const module = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: auth },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated audit-log requests', async () => {
    await request(app.getHttpServer())
      .get('/organizations/00000000-0000-4000-8000-000000000001/audit-logs')
      .expect(401);
    expect(auditLogs.list).not.toHaveBeenCalled();
  });

  it('uses the verified internal actor and parses pagination filters', async () => {
    auth.authenticate.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Verified Admin',
      email: 'admin@example.com',
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .get(
        '/organizations/00000000-0000-4000-8000-000000000001/audit-logs?page=2&pageSize=10&action=PROJECT_UPDATED',
      )
      .set('Authorization', 'Bearer verified-session')
      .expect(200)
      .expect({
        items: [],
        page: 1,
        pageSize: 25,
        hasMore: false,
      });

    expect(auditLogs.list).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { page: 2, pageSize: 10, action: 'PROJECT_UPDATED' },
    );
  });
});
