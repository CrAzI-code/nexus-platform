import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import type { NewNotification } from '../notifications/notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma.service.js';
import { OrganizationTeamService } from './organization-team.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pendingInvitation = {
  id: 'invitation-id',
  email: 'new.member@example.com',
  intendedRole: 'MEMBER' as const,
  expiresAt: new Date('2026-11-09T00:00:00.000Z'),
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
};

const transaction = {
  organization: { findFirst: vi.fn() },
  organizationMembership: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  invitation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  projectMember: { findMany: vi.fn(), updateMany: vi.fn() },
  user: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  notification: { createMany: vi.fn() },
};

describe('OrganizationTeamService', () => {
  let service: OrganizationTeamService;
  const prisma = { $transaction: vi.fn() };
  const notifications = {
    withTransaction: vi.fn(
      async <T>(
        operation: (
          tx: typeof transaction,
          publish: (items: NewNotification[]) => Promise<void>,
        ) => Promise<T>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ): Promise<T> =>
        prisma.$transaction(
          (tx: typeof transaction) =>
            operation(tx, async (items) => {
              await tx.notification.createMany({
                data: items,
                skipDuplicates: true,
              });
            }),
          options,
        ),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organization.findFirst.mockResolvedValue({
      id: 'organization-id',
      name: 'Acme Studio',
    });
    transaction.organizationMembership.findFirst.mockImplementation((args) => {
      const where = args.where as {
        user?: unknown;
        userId?: string;
      };
      if (where.user) return Promise.resolve(null);
      if (where.userId === 'member-id') {
        return Promise.resolve({
          userId: 'member-id',
          role: 'MEMBER',
          createdAt: new Date('2026-11-01T00:00:00.000Z'),
          user: { name: 'Team Member', email: 'member@example.com' },
        });
      }
      return Promise.resolve({ role: 'OWNER' });
    });
    transaction.organizationMembership.findUnique.mockResolvedValue(null);
    transaction.organizationMembership.findMany.mockResolvedValue([]);
    transaction.organizationMembership.update.mockResolvedValue({
      userId: 'member-id',
      role: 'ADMIN',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      user: { name: 'Team Member', email: 'member@example.com' },
    });
    transaction.organizationMembership.updateMany.mockResolvedValue({
      count: 1,
    });
    transaction.organizationMembership.upsert.mockResolvedValue({});
    transaction.invitation.findFirst.mockResolvedValue(null);
    transaction.invitation.findUnique.mockResolvedValue({
      ...pendingInvitation,
      organizationId: 'organization-id',
      status: 'PENDING',
      organization: { name: 'Acme Studio', status: 'ACTIVE' },
    });
    transaction.invitation.findMany.mockResolvedValue([]);
    transaction.invitation.create.mockResolvedValue(pendingInvitation);
    transaction.invitation.update.mockResolvedValue({
      ...pendingInvitation,
    });
    transaction.invitation.updateMany.mockResolvedValue({ count: 0 });
    transaction.projectMember.updateMany.mockResolvedValue({ count: 1 });
    transaction.projectMember.findMany.mockResolvedValue([]);
    transaction.auditLog.create.mockResolvedValue({ id: 'audit-log-id' });
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.notification.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      (
        operation: (tx: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationTeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(OrganizationTeamService);
  });

  it('creates a normalized invitation and returns its random token once', async () => {
    const result = await service.invite(
      'organization-id',
      'owner-id',
      ' New.Member@Example.com ',
      'MEMBER',
    );

    expect(result.invitation).toMatchObject({
      id: 'invitation-id',
      email: 'new.member@example.com',
      role: 'MEMBER',
      status: 'PENDING',
    });

    expect(result.invitationToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.invitation).not.toHaveProperty('tokenHash');
    const createCall = transaction.invitation.create.mock.calls[0]?.[0];
    expect(createCall.data).toMatchObject({
      organizationId: 'organization-id',
      inviterId: 'owner-id',
      email: 'new.member@example.com',
      intendedRole: 'MEMBER',
    });
    expect(createCall.data.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(createCall.data.tokenHash).not.toBe(result.invitationToken);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: 'organization-id',
          actorId: 'owner-id',
          action: 'INVITATION_CREATED',
          targetType: 'INVITATION',
          targetId: 'invitation-id',
          after: { role: 'MEMBER', status: 'PENDING' },
        },
      }),
    );
    expect(transaction.auditLog.create.mock.calls[0]?.[0].data).not.toHaveProperty(
      'tokenHash',
    );
  });

  it('creates an invitation notification for a matching active NEXUS account', async () => {
    transaction.user.findFirst.mockResolvedValue({ id: 'invitee-id' });

    await service.invite(
      'organization-id',
      'owner-id',
      'new.member@example.com',
      'MEMBER',
    );

    expect(transaction.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          recipientId: 'invitee-id',
          organizationId: 'organization-id',
          type: 'ORGANIZATION_INVITATION',
          resourceType: 'ORGANIZATION_INVITATION',
          resourceId: 'invitation-id',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('denies invitations by non-admin organization members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
    });

    await expect(
      service.invite(
        'organization-id',
        'manager-id',
        'new.member@example.com',
        'MEMBER',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.invitation.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate active invitations and existing active members', async () => {
    transaction.invitation.findFirst.mockResolvedValue({ id: 'active-invite' });

    await expect(
      service.invite(
        'organization-id',
        'owner-id',
        'new.member@example.com',
        'MEMBER',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.invitation.create).not.toHaveBeenCalled();

    transaction.invitation.findFirst.mockResolvedValue(null);
    transaction.organizationMembership.findFirst
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({ userId: 'member-id' });
    await expect(
      service.invite(
        'organization-id',
        'owner-id',
        'new.member@example.com',
        'MEMBER',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.invitation.create).not.toHaveBeenCalled();
  });

  it('retries serializable invitation conflicts and then rejects the duplicate', async () => {
    const serializationConflict = new Prisma.PrismaClientKnownRequestError(
      'Serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction
      .mockRejectedValueOnce(serializationConflict)
      .mockImplementationOnce(
        (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      );
    transaction.invitation.findFirst.mockResolvedValue({
      id: 'active-invite',
    });

    await expect(
      service.invite(
        'organization-id',
        'owner-id',
        'new.member@example.com',
        'MEMBER',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.invitation.create).not.toHaveBeenCalled();
  });

  it('accepts a valid invitation for the matching authenticated email exactly once', async () => {
    transaction.invitation.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      service.acceptInvitation(
        'a'.repeat(64),
        'verified-user-id',
        'NEW.MEMBER@example.com',
        true,
      ),
    ).resolves.toEqual({
      organizationId: 'organization-id',
      organizationName: 'Acme Studio',
      role: 'MEMBER',
    });

    expect(transaction.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invitation-id',
          status: 'PENDING',
        }),
        data: expect.objectContaining({ status: 'ACCEPTED' }),
      }),
    );
    expect(transaction.organizationMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId: 'organization-id',
            userId: 'verified-user-id',
          },
        },
        create: expect.objectContaining({
          role: 'MEMBER',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          actorId: 'verified-user-id',
          action: 'INVITATION_ACCEPTED',
          targetId: 'invitation-id',
        }),
      }),
    );
  });

  it('accepts a notification-linked invitation with the same verified-email checks', async () => {
    transaction.invitation.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.acceptInvitationById(
        'invitation-id',
        'verified-user-id',
        'NEW.MEMBER@example.com',
        true,
      ),
    ).resolves.toEqual({
      organizationId: 'organization-id',
      organizationName: 'Acme Studio',
      role: 'MEMBER',
    });
    expect(transaction.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invitation-id',
          status: 'PENDING',
        }),
        data: expect.objectContaining({ status: 'ACCEPTED' }),
      }),
    );
    expect(transaction.organizationMembership.upsert).toHaveBeenCalled();
  });

  it('rejects invitation notification acceptance for an unverified or mismatched email', async () => {
    await expect(
      service.acceptInvitationById(
        'invitation-id',
        'verified-user-id',
        'new.member@example.com',
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.acceptInvitationById(
        'invitation-id',
        'verified-user-id',
        'other@example.com',
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
    expect(transaction.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it('rejects an invitation when the authenticated email does not match', async () => {
    await expect(
      service.acceptInvitation(
        'a'.repeat(64),
        'verified-user-id',
        'different@example.com',
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
    expect(transaction.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it('requires the authenticated Clerk primary email to be verified', async () => {
    await expect(
      service.acceptInvitation(
        'a'.repeat(64),
        'verified-user-id',
        'new.member@example.com',
        false,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message:
          'Verify the email address on your NEXUS account before accepting an invitation.',
      }),
      status: 403,
    });
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
    expect(transaction.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it.each([
    {
      status: 'PENDING',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      message: 'expired',
    },
    {
      status: 'REVOKED',
      expiresAt: new Date('2026-11-09T00:00:00.000Z'),
      message: 'revoked',
    },
    {
      status: 'ACCEPTED',
      expiresAt: new Date('2026-11-09T00:00:00.000Z'),
      message: 'used',
    },
  ])('does not accept $message invitations', async ({ status, expiresAt }) => {
    transaction.invitation.findUnique.mockResolvedValue({
      ...pendingInvitation,
      organizationId: 'organization-id',
      status,
      expiresAt,
      organization: { name: 'Acme Studio', status: 'ACTIVE' },
    });

    await expect(
      service.acceptInvitation(
        'a'.repeat(64),
        'verified-user-id',
        'new.member@example.com',
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it('rejects revoked or unknown tokens without exposing token hashes', async () => {
    transaction.invitation.findUnique.mockResolvedValue(null);
    await expect(
      service.acceptInvitation(
        'a'.repeat(64),
        'verified-user-id',
        'new.member@example.com',
        true,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.organizationMembership.upsert).not.toHaveBeenCalled();
  });

  it('returns member details and omits invitations for non-admin members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.organizationMembership.findMany.mockResolvedValue([
      {
        userId: 'owner-id',
        role: 'OWNER',
        createdAt: new Date('2026-10-30T00:00:00.000Z'),
        user: { name: 'Acme Owner', email: 'owner@example.com' },
      },
    ]);

    await expect(
      service.getTeam('organization-id', 'member-id'),
    ).resolves.toMatchObject({
      organization: { id: 'organization-id', name: 'Acme Studio' },
      currentUserRole: 'MEMBER',
      canManage: false,
      members: [
        {
          userId: 'owner-id',
          name: 'Acme Owner',
          email: 'owner@example.com',
          role: 'OWNER',
        },
      ],
      invitations: [],
    });
    expect(transaction.invitation.findMany).not.toHaveBeenCalled();
  });

  it('allows an owner or admin to change a non-owner role', async () => {
    transaction.organizationMembership.findFirst
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({
        userId: 'member-id',
        role: 'MEMBER',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        user: { name: 'Team Member', email: 'member@example.com' },
      })
      .mockResolvedValueOnce({
        userId: 'member-id',
        role: 'ADMIN',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        user: { name: 'Team Member', email: 'member@example.com' },
      });
    await expect(
      service.updateMemberRole(
        'organization-id',
        'member-id',
        'owner-id',
        { role: 'ADMIN' },
      ),
    ).resolves.toMatchObject({
      userId: 'member-id',
      role: 'ADMIN',
      email: 'member@example.com',
    });
    expect(transaction.organizationMembership.updateMany).toHaveBeenCalledWith(
      expect.anything(),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'owner-id',
          action: 'ORGANIZATION_MEMBER_ROLE_CHANGED',
          targetId: 'member-id',
          before: { role: 'MEMBER' },
          after: { role: 'ADMIN' },
        }),
      }),
    );
  });

  it('revokes a pending invitation without returning its token hash', async () => {
    transaction.invitation.findFirst.mockResolvedValue({
      ...pendingInvitation,
      status: 'PENDING',
    });
    transaction.invitation.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      service.revokeInvitation(
        'organization-id',
        'invitation-id',
        'owner-id',
      ),
    ).resolves.toMatchObject({
      id: 'invitation-id',
      status: 'REVOKED',
    });

    expect(transaction.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invitation-id',
          organizationId: 'organization-id',
          status: 'PENDING',
        }),
        data: { status: 'REVOKED' },
      }),
    );
    expect(transaction.invitation.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INVITATION_REVOKED',
          actorId: 'owner-id',
          targetId: 'invitation-id',
        }),
      }),
    );
  });

  it('does not revoke invitations belonging to another organization', async () => {
    transaction.invitation.findFirst.mockResolvedValue(null);
    await expect(
      service.revokeInvitation(
        'organization-id',
        'invitation-id',
        'owner-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'ACCEPTED', expiresAt: pendingInvitation.expiresAt },
    { status: 'PENDING', expiresAt: new Date(0) },
    { status: 'REVOKED', expiresAt: pendingInvitation.expiresAt },
  ])(
    'does not revoke an invitation with status $status or an expired invitation',
    async ({ status, expiresAt }) => {
      transaction.invitation.findFirst.mockResolvedValue({
        ...pendingInvitation,
        status,
        expiresAt,
      });

      await expect(
        service.revokeInvitation(
          'organization-id',
          'invitation-id',
          'owner-id',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
    },
  );

  it('denies invitation revocation for non-admin members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    await expect(
      service.revokeInvitation(
        'organization-id',
        'invitation-id',
        'member-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
  });

  it('protects the owner from demotion and removal', async () => {
    transaction.organizationMembership.findFirst
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({
        userId: 'owner-id',
        role: 'OWNER',
        createdAt: new Date(),
        user: { name: 'Owner', email: 'owner@example.com' },
      });

    await expect(
      service.updateMemberRole(
        'organization-id',
        'owner-id',
        'owner-id',
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.removeMember('organization-id', 'owner-id', 'owner-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.organizationMembership.update).not.toHaveBeenCalled();
    expect(transaction.organizationMembership.updateMany).not.toHaveBeenCalled();
  });

  it('denies role changes and removal to non-admin members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
    });
    await expect(
      service.updateMemberRole(
        'organization-id',
        'member-id',
        'manager-id',
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.removeMember(
        'organization-id',
        'member-id',
        'manager-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.organizationMembership.updateMany).not.toHaveBeenCalled();
  });

  it('removes membership and project access without deleting history', async () => {
    transaction.projectMember.findMany.mockResolvedValue([
      { id: 'project-member-id', status: 'ACTIVE' },
    ]);
    transaction.organizationMembership.findFirst
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({
        userId: 'member-id',
        role: 'MEMBER',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        user: { name: 'Team Member', email: 'member@example.com' },
      });
    await expect(
      service.removeMember('organization-id', 'member-id', 'owner-id'),
    ).resolves.toEqual({ userId: 'member-id', status: 'REMOVED' });

    expect(transaction.organizationMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'organization-id',
          userId: 'member-id',
          role: { not: 'OWNER' },
        }),
        data: { status: 'REMOVED' },
      }),
    );
    expect(transaction.projectMember.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-id',
        userId: 'member-id',
        status: 'ACTIVE',
      },
      data: { status: 'REMOVED' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          actorId: 'owner-id',
          action: 'ORGANIZATION_MEMBER_REMOVED',
          targetId: 'member-id',
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PROJECT_MEMBER_REMOVED',
          actorId: 'owner-id',
          targetId: 'project-member-id',
          before: { status: 'ACTIVE' },
          after: { status: 'REMOVED' },
        }),
      }),
    );
  });

  it('prevents cross-organization team access', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue(null);
    await expect(
      service.getTeam('another-organization-id', 'member-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
