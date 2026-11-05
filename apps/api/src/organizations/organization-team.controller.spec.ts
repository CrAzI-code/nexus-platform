import { ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkAuthService } from '../auth/clerk-auth.service.js';
import { BrevoEmailService } from '../email/brevo-email.service.js';
import {
  InvitationAcceptanceController,
  OrganizationTeamController,
} from './organization-team.controller.js';
import { OrganizationTeamService } from './organization-team.service.js';

const organizationId = 'a4d980b7-6493-4f82-92d4-0dd8c41dba14';
const memberId = '42da5769-a178-4f22-96ac-39e1299b824a';

describe('Organization team controllers', () => {
  let app: INestApplication<App>;
  const user: AuthenticatedUser = {
    id: 'verified-user-id',
    name: 'NEXUS Owner',
    email: 'owner@example.com',
    status: 'ACTIVE',
    primaryEmailVerified: true,
  };
  const clerkAuth = { authenticate: vi.fn() };
  const team = {
    getTeam: vi.fn(),
    invite: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    declineInvitationById: vi.fn(),
  };
  const email = { sendOrganizationInvitation: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    clerkAuth.authenticate.mockResolvedValue(user);
    team.getTeam.mockResolvedValue({
      organization: { id: organizationId, name: 'Acme Studio' },
      currentUserRole: 'OWNER',
      canManage: true,
      members: [],
      invitations: [],
    });
    team.invite.mockResolvedValue({
      invitation: {
        id: 'invitation-id',
        email: 'invitee@example.com',
        role: 'MEMBER',
        status: 'PENDING',
        expiresAt: '2026-11-09T00:00:00.000Z',
        createdAt: '2026-11-02T00:00:00.000Z',
      },
      invitationToken: 'a'.repeat(64),
      organizationName: 'Acme Studio',
    });
    team.resendInvitation.mockResolvedValue({
      invitation: {
        id: memberId,
        email: 'invitee@example.com',
        role: 'MEMBER',
        status: 'PENDING',
        expiresAt: '2026-11-09T00:00:00.000Z',
        createdAt: '2026-11-02T00:00:00.000Z',
      },
      invitationToken: 'b'.repeat(64),
      organizationName: 'Acme Studio',
    });
    email.sendOrganizationInvitation.mockResolvedValue('sent');
    team.revokeInvitation.mockResolvedValue({});
    team.updateMemberRole.mockResolvedValue({});
    team.removeMember.mockResolvedValue({});
    team.acceptInvitation.mockResolvedValue({
      organizationId,
      organizationName: 'Acme Studio',
      role: 'MEMBER',
    });
    team.declineInvitation.mockResolvedValue({
      organizationId,
      status: 'DECLINED',
    });
    team.declineInvitationById.mockResolvedValue({
      organizationId,
      status: 'DECLINED',
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        OrganizationTeamController,
        InvitationAcceptanceController,
      ],
      providers: [
        ClerkAuthGuard,
        { provide: ClerkAuthService, useValue: clerkAuth },
        { provide: BrevoEmailService, useValue: email },
        { provide: OrganizationTeamService, useValue: team },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication for team and invitation routes', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/members`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .send({ email: 'invitee@example.com' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(
        `/organizations/${organizationId}/invitations/${memberId}`,
      )
      .expect(401);
    expect(team.getTeam).not.toHaveBeenCalled();
    expect(team.invite).not.toHaveBeenCalled();
    expect(team.revokeInvitation).not.toHaveBeenCalled();
  });

  it('scopes team listing to the organization and verified user', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/members`)
      .set('Authorization', 'Bearer test-session-token')
      .expect(200);

    expect(team.getTeam).toHaveBeenCalledWith(
      organizationId,
      'verified-user-id',
    );
  });

  it('validates invitation input and disallows OWNER grants', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', 'Bearer test-session-token')
      .send({
        email: 'invitee@example.com',
        role: 'OWNER',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', 'Bearer test-session-token')
      .send({
        email: 'invitee@example.com',
        role: 'MEMBER',
        userId: 'untrusted-user-id',
      })
      .expect(400);

    expect(team.invite).not.toHaveBeenCalled();
  });

  it('uses the authenticated user as inviter and returns the one-time token only on creation', async () => {
    const response = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', 'Bearer test-session-token')
      .send({ email: 'invitee@example.com', role: 'MEMBER' })
      .expect(201);

    expect(team.invite).toHaveBeenCalledWith(
      organizationId,
      'verified-user-id',
      'invitee@example.com',
      'MEMBER',
    );
    expect(email.sendOrganizationInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'invitee@example.com',
        organizationName: 'Acme Studio',
        inviterName: 'NEXUS Owner',
        invitationToken: 'a'.repeat(64),
      }),
    );
    expect(response.body.emailDeliveryStatus).toBe('sent');
    expect(response.body.invitationToken).toBe('a'.repeat(64));
    expect(response.body.invitation).not.toHaveProperty('tokenHash');
  });

  it('keeps the created invitation and share token when email delivery fails', async () => {
    email.sendOrganizationInvitation.mockResolvedValue('failed');

    const response = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', 'Bearer test-session-token')
      .send({ email: 'invitee@example.com', role: 'MEMBER' })
      .expect(201);

    expect(team.invite).toHaveBeenCalledTimes(1);
    expect(response.body.emailDeliveryStatus).toBe('failed');
    expect(response.body.invitationToken).toBe('a'.repeat(64));
  });

  it('does not send a second email when invitation creation conflicts', async () => {
    team.invite.mockRejectedValue(
      new ConflictException('An active invitation already exists.'),
    );

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invitations`)
      .set('Authorization', 'Bearer test-session-token')
      .send({ email: 'invitee@example.com', role: 'MEMBER' })
      .expect(409);

    expect(email.sendOrganizationInvitation).not.toHaveBeenCalled();
  });

  it('revokes an invitation within the authenticated organization', async () => {
    team.revokeInvitation.mockResolvedValue({
      id: memberId,
      email: 'invitee@example.com',
      role: 'MEMBER',
      status: 'REVOKED',
      expiresAt: '2026-11-09T00:00:00.000Z',
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .delete(
        `/organizations/${organizationId}/invitations/${memberId}`,
      )
      .set('Authorization', 'Bearer test-session-token')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('REVOKED');
        expect(response.body).not.toHaveProperty('tokenHash');
      });

    expect(team.revokeInvitation).toHaveBeenCalledWith(
      organizationId,
      memberId,
      'verified-user-id',
    );
  });

  it('resends a pending invitation with a rotated one-time token', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/organizations/${organizationId}/invitations/${memberId}/resend`,
      )
      .set('Authorization', 'Bearer test-token');

    expect(clerkAuth.authenticate).toHaveBeenCalled();
    expect(response.status, response.text).toBe(201);
    expect(team.resendInvitation).toHaveBeenCalledWith(
      organizationId,
      memberId,
      user.id,
    );
    expect(email.sendOrganizationInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'invitee@example.com',
        invitationToken: 'b'.repeat(64),
      }),
    );
    expect(response.body.invitationToken).toBe('b'.repeat(64));
    expect(response.body.invitation).not.toHaveProperty('tokenHash');
  });

  it('rejects malformed invitation IDs before calling the service', async () => {
    await request(app.getHttpServer())
      .delete(
        `/organizations/${organizationId}/invitations/not-a-uuid`,
      )
      .set('Authorization', 'Bearer test-session-token')
      .expect(400);

    expect(team.revokeInvitation).not.toHaveBeenCalled();
  });

  it('rejects invalid acceptance token shapes before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Authorization', 'Bearer test-session-token')
      .send({ token: 'not-a-token' })
      .expect(400);

    expect(team.acceptInvitation).not.toHaveBeenCalled();
  });

  it('accepts a token using the verified internal user and email', async () => {
    await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Authorization', 'Bearer test-session-token')
      .send({ token: 'a'.repeat(64) })
      .expect(201);

    expect(team.acceptInvitation).toHaveBeenCalledWith(
      'a'.repeat(64),
      user.id,
      user.email,
      true,
    );
  });

  it('declines token and notification-linked invitations for the authenticated user', async () => {
    const tokenResponse = await request(app.getHttpServer())
      .post('/invitations/decline')
      .set('Authorization', 'Bearer test-token')
      .send({ token: 'a'.repeat(64) });
    expect(clerkAuth.authenticate).toHaveBeenCalled();
    expect(tokenResponse.status, tokenResponse.text).toBe(201);
    expect(tokenResponse.body).toEqual({ organizationId, status: 'DECLINED' });

    const idResponse = await request(app.getHttpServer())
      .post(`/invitations/${memberId}/decline`)
      .set('Authorization', 'Bearer test-token');
    expect(idResponse.status, idResponse.text).toBe(201);

    expect(team.declineInvitation).toHaveBeenCalledWith(
      'a'.repeat(64),
      user.id,
      user.email,
      true,
    );
    expect(team.declineInvitationById).toHaveBeenCalledWith(
      memberId,
      user.id,
      user.email,
      true,
    );
  });

  it('validates member route IDs and never accepts a client actor ID', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}/members/${memberId}/role`)
      .set('Authorization', 'Bearer test-session-token')
      .send({ role: 'ADMIN', userId: 'untrusted-actor-id' })
      .expect(400);

    expect(team.updateMemberRole).not.toHaveBeenCalled();
  });
});
