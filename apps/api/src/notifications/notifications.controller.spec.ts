import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsController stream authentication', () => {
  let app: INestApplication<App>;
  const auth = { authenticate: vi.fn() };
  const notifications = { streamFor: vi.fn() };

  beforeEach(async () => {
    auth.authenticate.mockReset();
    notifications.streamFor.mockReset();
    notifications.streamFor.mockReturnValue(
      of({
        type: 'heartbeat',
        data: { timestamp: '2026-11-02T00:00:00.000Z' },
      }),
    );
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: auth },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated stream requests', async () => {
    await request(app.getHttpServer()).get('/notifications/stream').expect(401);
    expect(notifications.streamFor).not.toHaveBeenCalled();
  });

  it('derives the stream recipient from the authenticated user context', async () => {
    auth.authenticate.mockResolvedValue({
      id: 'internal-user-id',
      name: 'NEXUS User',
      email: 'user@example.com',
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .get('/notifications/stream')
      .set(
        'Last-Event-ID',
        '2026-11-02T00:00:00.000Z|123e4567-e89b-42d3-a456-426614174000',
      )
      .set('Authorization', 'Bearer verified-session')
      .expect('Content-Type', /text\/event-stream/)
      .expect(200);

    expect(notifications.streamFor).toHaveBeenCalledWith(
      'internal-user-id',
      'user@example.com',
      false,
      '2026-11-02T00:00:00.000Z|123e4567-e89b-42d3-a456-426614174000',
    );
  });
});
