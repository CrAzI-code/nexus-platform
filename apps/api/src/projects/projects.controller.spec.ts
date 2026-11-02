import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

describe('ProjectsController', () => {
  let app: INestApplication<App>;
  const user: AuthenticatedUser = {
    id: 'verified-user-id',
    name: 'NEXUS User',
    email: 'user@example.com',
    status: 'ACTIVE',
  };
  const clerkAuth = { authenticate: vi.fn() };
  const projects = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };
  const project = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Roadmap',
    description: null,
    status: 'ACTIVE',
    canManage: true,
  };
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const projectId = project.id;
  const route = `/organizations/${organizationId}/projects`;

  beforeEach(async () => {
    vi.clearAllMocks();
    clerkAuth.authenticate.mockResolvedValue(user);
    projects.create.mockResolvedValue(project);
    projects.list.mockResolvedValue([project]);
    projects.get.mockResolvedValue(project);
    projects.update.mockResolvedValue(project);
    projects.archive.mockResolvedValue({ ...project, status: 'ARCHIVED' });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: clerkAuth },
        { provide: ProjectsService, useValue: projects },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated project requests', async () => {
    await request(app.getHttpServer()).get(route).expect(401);
    expect(projects.list).not.toHaveBeenCalled();
  });

  it('rejects malformed organization and project IDs', async () => {
    await request(app.getHttpServer())
      .get('/organizations/not-a-uuid/projects')
      .set('Authorization', 'Bearer verified-token')
      .expect(400);

    await request(app.getHttpServer())
      .get(`${route}/not-a-uuid`)
      .set('Authorization', 'Bearer verified-token')
      .expect(400);
  });

  it('creates a project using the verified user and route organization', async () => {
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer verified-token')
      .send({ name: 'Roadmap', description: 'Planning' })
      .expect(201)
      .expect(project);

    expect(projects.create).toHaveBeenCalledWith(organizationId, user.id, {
      name: 'Roadmap',
      description: 'Planning',
    });
  });

  it('rejects client-supplied user IDs, roles, and organization IDs', async () => {
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer verified-token')
      .send({
        name: 'Roadmap',
        organizationId: 'another-organization',
        userId: 'another-user',
        role: 'OWNER',
      })
      .expect(400);

    expect(projects.create).not.toHaveBeenCalled();
  });

  it('lists, gets, updates and archives projects in the organization scope', async () => {
    const auth = { Authorization: 'Bearer verified-token' };
    await request(app.getHttpServer())
      .get(route)
      .set(auth)
      .expect(200)
      .expect([project]);
    await request(app.getHttpServer())
      .get(`${route}/${projectId}`)
      .set(auth)
      .expect(200)
      .expect(project);
    await request(app.getHttpServer())
      .patch(`${route}/${projectId}`)
      .set(auth)
      .send({ name: 'Updated Roadmap', description: null })
      .expect(200)
      .expect(project);
    await request(app.getHttpServer())
      .patch(`${route}/${projectId}/archive`)
      .set(auth)
      .expect(200)
      .expect({ ...project, status: 'ARCHIVED' });

    expect(projects.list).toHaveBeenCalledWith(organizationId, user.id);
    expect(projects.get).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
    );
    expect(projects.update).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
      { name: 'Updated Roadmap', description: null },
    );
    expect(projects.archive).toHaveBeenCalledWith(
      organizationId,
      projectId,
      user.id,
    );
  });

  it('rejects invalid and empty project update bodies', async () => {
    await request(app.getHttpServer())
      .patch(`${route}/${projectId}`)
      .set('Authorization', 'Bearer verified-token')
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .patch(`${route}/${projectId}`)
      .set('Authorization', 'Bearer verified-token')
      .send({ status: 'ARCHIVED' })
      .expect(400);

    expect(projects.update).not.toHaveBeenCalled();
  });
});
