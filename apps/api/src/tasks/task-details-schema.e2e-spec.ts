import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import dotenv from 'dotenv';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { PrismaService } from '../prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

const enabled = process.env.NEXUS_TASK_DETAILS_DB_E2E === 'true';
if (enabled) {
  dotenv.config({
    path: fileURLToPath(new URL('../../.env', import.meta.url)),
  });
}

describe.skipIf(!enabled)('Task details blocker-schema regression (local DB)', () => {
  let app: INestApplication<App>;
  let database: PrismaService;
  let taskFixture: {
    id: string;
    organizationId: string;
    projectId: string;
    creatorId: string;
  };

  const user: AuthenticatedUser = {
    id: '',
    name: 'Regression Test User',
    email: 'regression@example.test',
    status: 'ACTIVE',
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for this test.');
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new Error(
        'This regression test may only run against a loopback database.',
      );
    }

    database = new PrismaService();
    await database.$connect();
    const storedTask = await database.task.findFirst({
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        creatorId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!storedTask) {
      throw new Error(
        'The loopback database needs an existing task for this regression test.',
      );
    }
    taskFixture = storedTask;
    user.id = storedTask.creatorId;

    const transaction = {
      organizationMembership: {
        findFirst: vi.fn().mockResolvedValue({ role: 'OWNER' }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      projectMember: { findFirst: vi.fn().mockResolvedValue(null) },
      task: {
        findFirst: database.task.findFirst.bind(database.task),
      },
    };
    const prisma = {
      $transaction: <T>(
        operation: (tx: typeof transaction) => Promise<T>,
      ): Promise<T> => operation(transaction),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        TasksService,
        ClerkAuthGuard,
        {
          provide: ClerkAuthService,
          useValue: { authenticate: vi.fn().mockResolvedValue(user) },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: { withTransaction: vi.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.$disconnect();
  });

  it('returns the blocker-aware details payload for an existing local task', async () => {
    await request(app.getHttpServer())
      .get(
        `/organizations/${taskFixture.organizationId}/projects/${taskFixture.projectId}/tasks/${taskFixture.id}`,
      )
      .set('Authorization', 'Bearer local-regression-test')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: taskFixture.id,
          projectId: taskFixture.projectId,
          status: expect.any(String),
          creator: {
            id: taskFixture.creatorId,
            name: expect.any(String),
          },
          comments: expect.any(Array),
          activity: expect.any(Array),
          blockerHistory: expect.any(Array),
        });
        expect(
          response.body.activeBlocker === null ||
            typeof response.body.activeBlocker === 'object',
        ).toBe(true);
      });
  });
});
