import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma.service.js';
import { OverdueNotificationsService } from './../src/notifications/overdue-notifications.service.js';
import { WorkflowAutomationsService } from './../src/workflow-automations/workflow-automations.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: { count: vi.fn().mockResolvedValue(0) } })
      .overrideProvider(OverdueNotificationsService)
      .useValue({ onModuleInit: vi.fn(), onModuleDestroy: vi.fn() })
      .overrideProvider(WorkflowAutomationsService)
      .useValue({ onModuleInit: vi.fn(), onModuleDestroy: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    if (app) await app.close();
  });
});
