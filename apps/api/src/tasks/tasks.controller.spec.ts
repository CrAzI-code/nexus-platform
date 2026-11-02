import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

describe('TasksController', () => {
  let app: INestApplication<App>;
  const user: AuthenticatedUser = {
    id: 'verified-user-id',
    name: 'NEXUS User',
    email: 'user@example.com',
    status: 'ACTIVE',
  };
  const auth = { authenticate: vi.fn() };
  const tasks = {
    create: vi.fn(),
    list: vi.fn(),
    listMembers: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    assign: vi.fn(),
    changeStatus: vi.fn(),
    addComment: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
  };
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const projectId = '33333333-3333-4333-8333-333333333333';
  const taskId = '44444444-4444-4444-8444-444444444444';
  const route = `/organizations/${organizationId}/projects/${projectId}/tasks`;
  const response = { id: taskId, title: 'Prepare launch' };

  beforeEach(async () => {
    vi.clearAllMocks();
    auth.authenticate.mockResolvedValue(user);
    for (const method of Object.values(tasks)) {
      method.mockResolvedValue(response);
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: auth },
        { provide: TasksService, useValue: tasks },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated task requests', async () => {
    await request(app.getHttpServer()).get(route).expect(401);
    expect(tasks.list).not.toHaveBeenCalled();
  });

  it('rejects malformed organization, project, and task IDs', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/not-a-uuid/projects/${projectId}/tasks`)
      .set('Authorization', 'Bearer test')
      .expect(400);
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/projects/not-a-uuid/tasks`)
      .set('Authorization', 'Bearer test')
      .expect(400);
    await request(app.getHttpServer())
      .get(`${route}/not-a-uuid`)
      .set('Authorization', 'Bearer test')
      .expect(400);
  });

  it('creates and lists tasks using only the verified identity and route scope', async () => {
    const headers = { Authorization: 'Bearer test' };
    await request(app.getHttpServer())
      .post(route)
      .set(headers)
      .send({ title: 'Prepare launch', priority: 'HIGH' })
      .expect(201)
      .expect(response);
    await request(app.getHttpServer())
      .get(route)
      .set(headers)
      .expect(200)
      .expect(response);
    await request(app.getHttpServer())
      .get(`${route}/members`)
      .set(headers)
      .expect(200);

    expect(tasks.create).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
      { title: 'Prepare launch', priority: 'HIGH' },
    );
    expect(tasks.list).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
    );
    expect(tasks.listMembers).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
    );
  });

  it('rejects client-supplied user, organization, and role fields', async () => {
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer test')
      .send({
        title: 'Prepare launch',
        userId: 'another-user',
        organizationId: 'another-organization',
        role: 'OWNER',
      })
      .expect(400);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('validates edit, status, assignment, comments, archive, and restore routes', async () => {
    const headers = { Authorization: 'Bearer test' };
    await request(app.getHttpServer())
      .get(`${route}/${taskId}`)
      .set(headers)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}`)
      .set(headers)
      .send({ title: 'Updated task' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/assignee`)
      .set(headers)
      .send({ assigneeId: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/status`)
      .set(headers)
      .send({ status: 'BLOCKED', blockerReason: 'Waiting on a review' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${route}/${taskId}/comments`)
      .set(headers)
      .send({ body: 'I can take this.' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/archive`)
      .set(headers)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/restore`)
      .set(headers)
      .expect(200);

    expect(tasks.get).toHaveBeenCalledWith(
      organizationId,
      projectId,
      taskId,
      user.id,
    );
    expect(tasks.update).toHaveBeenCalledWith(
      organizationId,
      projectId,
      taskId,
      user.id,
      { title: 'Updated task' },
    );
    expect(tasks.assign).toHaveBeenCalledWith(
      organizationId,
      projectId,
      taskId,
      user.id,
      { assigneeId: null },
    );
    expect(tasks.changeStatus).toHaveBeenCalledWith(
      organizationId,
      projectId,
      taskId,
      user.id,
      { status: 'BLOCKED', blockerReason: 'Waiting on a review' },
    );
    expect(tasks.addComment).toHaveBeenCalledWith(
      organizationId,
      projectId,
      taskId,
      user.id,
      { body: 'I can take this.' },
    );
  });

  it('rejects invalid dates, blocked statuses without a reason, and invalid assignees', async () => {
    const headers = { Authorization: 'Bearer test' };
    await request(app.getHttpServer())
      .post(route)
      .set(headers)
      .send({ title: 'Task', dueAt: '2026-02-31' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/status`)
      .set(headers)
      .send({ status: 'BLOCKED' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${route}/${taskId}/assignee`)
      .set(headers)
      .send({ assigneeId: 'not-a-uuid' })
      .expect(400);
    expect(tasks.create).not.toHaveBeenCalled();
    expect(tasks.changeStatus).not.toHaveBeenCalled();
    expect(tasks.assign).not.toHaveBeenCalled();
  });
});
