import {
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from './authenticated-user.js';
import { AuthController } from './auth.controller.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { ClerkAuthService } from './clerk-auth.service.js';

describe('ClerkAuthGuard', () => {
  let app: INestApplication<App>;
  const clerkAuth = { authenticate: vi.fn() };
  const user: AuthenticatedUser = {
    id: 'internal-user-id',
    name: 'NEXUS User',
    email: 'user@example.com',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    clerkAuth.authenticate.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: clerkAuth },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('authenticates a bearer token and attaches the NEXUS user context', async () => {
    clerkAuth.authenticate.mockResolvedValue(user);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer verified-token')
      .expect(200)
      .expect(user);

    expect(clerkAuth.authenticate).toHaveBeenCalledWith('verified-token');
  });

  it('rejects requests with a missing bearer token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(clerkAuth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer tokens', async () => {
    clerkAuth.authenticate.mockRejectedValue(
      new UnauthorizedException('Invalid or expired session token.'),
    );

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('rejects a NEXUS account that is not active', async () => {
    clerkAuth.authenticate.mockResolvedValue({ ...user, status: 'SUSPENDED' });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer verified-token')
      .expect(403);
  });
});
