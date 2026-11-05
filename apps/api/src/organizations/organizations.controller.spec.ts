import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

const organizationId = 'a4d980b7-6493-4f82-92d4-0dd8c41dba14';

describe('OrganizationsController', () => {
  let app: INestApplication<App>;
  const user: AuthenticatedUser = {
    id: 'verified-user-id',
    name: 'NEXUS User',
    email: 'user@example.com',
    status: 'ACTIVE',
  };
  const clerkAuth = { authenticate: vi.fn() };
  const organizations = {
    create: vi.fn(),
    listForUser: vi.fn(),
    updateName: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    clerkAuth.authenticate.mockResolvedValue(user);
    organizations.create.mockResolvedValue({
      id: 'organization-id',
      name: 'Acme Studio',
      slug: 'acme-studio',
      role: 'OWNER',
    });
    organizations.listForUser.mockResolvedValue([]);
    organizations.updateName.mockResolvedValue({
      id: 'organization-id',
      name: 'Updated Studio',
      slug: 'acme-studio',
      role: 'ADMIN',
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: clerkAuth },
        { provide: OrganizationsService, useValue: organizations },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects organization creation without authentication', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .send({ name: 'Acme Studio' })
      .expect(401);
    expect(organizations.create).not.toHaveBeenCalled();
  });

  it('rejects organization listing without authentication', async () => {
    await request(app.getHttpServer()).get('/organizations').expect(401);
    expect(organizations.listForUser).not.toHaveBeenCalled();
  });

  it('creates the organization for the verified user and returns the OWNER role', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', 'Bearer verified-token')
      .send({ name: 'Acme Studio' })
      .expect(201)
      .expect({
        id: 'organization-id',
        name: 'Acme Studio',
        slug: 'acme-studio',
        role: 'OWNER',
      });

    expect(organizations.create).toHaveBeenCalledWith(
      'verified-user-id',
      'Acme Studio',
    );
  });

  it('rejects client-supplied user IDs and roles', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', 'Bearer verified-token')
      .send({ name: 'Acme Studio', userId: 'another-user', role: 'OWNER' })
      .expect(400);

    expect(organizations.create).not.toHaveBeenCalled();
  });

  it('returns only the authenticated user’s organizations', async () => {
    organizations.listForUser.mockResolvedValue([
      {
        id: 'organization-id',
        name: 'Acme Studio',
        slug: 'acme-studio',
        role: 'OWNER',
      },
    ]);

    await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', 'Bearer verified-token')
      .expect(200)
      .expect([
        {
          id: 'organization-id',
          name: 'Acme Studio',
          slug: 'acme-studio',
          role: 'OWNER',
        },
      ]);

    expect(organizations.listForUser).toHaveBeenCalledWith('verified-user-id');
  });

  it('validates organization names before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', 'Bearer verified-token')
      .send({ name: '   ' })
      .expect(400);

    expect(organizations.create).not.toHaveBeenCalled();
  });

  it('rejects organization profile changes without authentication', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .send({ name: 'Updated Studio' })
      .expect(401);
    expect(organizations.updateName).not.toHaveBeenCalled();
  });

  it('validates and applies organization name updates for the authenticated user', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', 'Bearer test-token')
      .send({ name: '  Updated Studio  ' })
      .expect(200)
      .expect({
        id: 'organization-id',
        name: 'Updated Studio',
        slug: 'acme-studio',
        role: 'ADMIN',
      });

    expect(organizations.updateName).toHaveBeenCalledWith(
      organizationId,
      'verified-user-id',
      'Updated Studio',
    );
  });

  it('rejects malformed or extra organization profile fields', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', 'Bearer test-token')
      .send({ name: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated Studio', slug: 'attacker-slug' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/organizations/not-a-uuid')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated Studio' })
      .expect(400);

    expect(organizations.updateName).not.toHaveBeenCalled();
  });
});
