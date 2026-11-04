import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  InvitationRole,
  OrganizationRole,
} from '../generated/prisma/client.js';
import type { EmailDeliveryStatus } from '../email/email.types.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { PrismaService } from '../prisma.service.js';
import type { UpdateMemberRoleDto } from './team.dto.js';
import {
  NotificationsService,
  type NewNotification,
} from '../notifications/notifications.service.js';

const INVITATION_LIFETIME_DAYS = 7;
const SERIALIZABLE_RETRIES = 3;

const memberSelect = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
} satisfies Prisma.OrganizationMembershipSelect;

const invitationSelect = {
  id: true,
  email: true,
  intendedRole: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.InvitationSelect;

const acceptanceInvitationSelect = {
  id: true,
  organizationId: true,
  email: true,
  intendedRole: true,
  status: true,
  expiresAt: true,
  organization: { select: { name: true, status: true } },
} satisfies Prisma.InvitationSelect;

type Transaction = Prisma.TransactionClient;
type MemberRecord = Prisma.OrganizationMembershipGetPayload<{
  select: typeof memberSelect;
}>;
type InvitationRecord = Prisma.InvitationGetPayload<{
  select: typeof invitationSelect;
}>;
type AcceptanceInvitation = Prisma.InvitationGetPayload<{
  select: typeof acceptanceInvitationSelect;
}>;

export interface InvitationAcceptanceDetails {
  id: string;
  organizationName: string;
  expiresAt: Date;
}

interface TeamAccess {
  role: OrganizationRole;
}

export interface OrganizationMemberResponse {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: Date;
}

export interface OrganizationInvitationResponse {
  id: string;
  email: string;
  role: InvitationRole;
  status: 'PENDING' | 'REVOKED';
  expiresAt: Date;
  createdAt: Date;
}

export interface OrganizationTeamResponse {
  organization: { id: string; name: string };
  currentUserRole: OrganizationRole;
  canManage: boolean;
  members: OrganizationMemberResponse[];
  invitations: OrganizationInvitationResponse[];
}

export interface CreatedInvitationResponse {
  invitation: OrganizationInvitationResponse;
  invitationToken: string;
  emailDeliveryStatus: EmailDeliveryStatus;
}

export interface CreatedInvitation {
  invitation: OrganizationInvitationResponse;
  invitationToken: string;
  organizationName: string;
}

export interface AcceptedInvitationResponse {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
}

export interface DeclinedInvitationResponse {
  organizationId: string;
  status: 'DECLINED';
}

@Injectable()
export class OrganizationTeamService {
  private readonly logger = new Logger(OrganizationTeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getTeam(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationTeamResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.findAccess(transaction, organizationId, userId);
      const organization = await transaction.organization.findFirst({
        where: { id: organizationId, status: 'ACTIVE' },
        select: { id: true, name: true },
      });
      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }

      const now = new Date();
      const canManage = this.canManage(access.role);
      const [members, invitations] = await Promise.all([
        transaction.organizationMembership.findMany({
          where: { organizationId, status: 'ACTIVE' },
          select: memberSelect,
          orderBy: { createdAt: 'asc' },
        }),
        canManage
          ? this.listPendingInvitations(transaction, organizationId, now)
          : Promise.resolve([]),
      ]);

      return {
        organization,
        currentUserRole: access.role,
        canManage,
        members: members.map((member) => this.toMemberResponse(member)),
        invitations: invitations.map((invitation) =>
          this.toInvitationResponse(invitation),
        ),
      };
    });
  }

  async invite(
    organizationId: string,
    userId: string,
    email: string,
    role: InvitationRole,
  ): Promise<CreatedInvitation> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.withSerializableRetry(async (transaction, publish) => {
      const access = await this.findAccess(transaction, organizationId, userId);
      this.assertCanManage(access.role);
      const organization = await transaction.organization.findFirst({
        where: { id: organizationId, status: 'ACTIVE' },
        select: { name: true },
      });
      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }

      const now = new Date();
      await transaction.invitation.updateMany({
        where: {
          organizationId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
          status: 'PENDING',
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
      });

      const activeEmailMembership =
        await transaction.organizationMembership.findFirst({
          where: {
            organizationId,
            status: 'ACTIVE',
            user: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          },
          select: { userId: true },
        });
      if (activeEmailMembership) {
        throw new ConflictException(
          'This person is already a member of the organization.',
        );
      }
      const suspendedEmailMembership =
        await transaction.organizationMembership.findFirst({
          where: {
            organizationId,
            status: 'SUSPENDED',
            user: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          },
          select: { userId: true },
        });
      if (suspendedEmailMembership) {
        throw new ConflictException(
          'This person’s organization membership is suspended.',
        );
      }

      const existingInvitation = await transaction.invitation.findFirst({
        where: {
          organizationId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
          status: 'PENDING',
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (existingInvitation) {
        throw new ConflictException(
          'An active invitation already exists for this email address.',
        );
      }

      const invitationToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(invitationToken);
      const expiresAt = new Date(now);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_LIFETIME_DAYS);

      const invitation = await transaction.invitation.create({
        data: {
          organizationId,
          inviterId: userId,
          email: normalizedEmail,
          intendedRole: role,
          tokenHash,
          expiresAt,
        },
        select: invitationSelect,
      });
      await AuditLogsService.record(transaction, {
        organizationId,
        actorId: userId,
        action: 'INVITATION_CREATED',
        targetType: 'INVITATION',
        targetId: invitation.id,
        after: { role, status: 'PENDING' },
      });

      const invitee = await transaction.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (invitee) {
        await publish([
          {
            recipientId: invitee.id,
            organizationId,
            type: 'ORGANIZATION_INVITATION',
            title: 'Organization invitation',
            message: `${organization.name} invited you to join the team.`,
            resourceType: 'ORGANIZATION_INVITATION',
            resourceId: invitation.id,
            eventKey: `organization-invitation:${invitation.id}`,
          },
        ]);
      }

      return {
        invitation: this.toInvitationResponse(invitation),
        invitationToken,
        organizationName: organization.name,
      };
    });
  }

  async revokeInvitation(
    organizationId: string,
    invitationId: string,
    userId: string,
  ): Promise<OrganizationInvitationResponse> {
    return this.withSerializableRetry(async (transaction) => {
      const access = await this.findAccess(transaction, organizationId, userId);
      this.assertCanManage(access.role);

      const invitation = await transaction.invitation.findFirst({
        where: { id: invitationId, organizationId },
        select: { ...invitationSelect, status: true },
      });
      if (!invitation) {
        throw new NotFoundException('Invitation not found.');
      }
      if (invitation.status !== 'PENDING') {
        throw new ConflictException(
          'Only pending invitations can be revoked.',
        );
      }
      if (invitation.expiresAt <= new Date()) {
        throw new ConflictException('This invitation has expired.');
      }

      const revoked = await transaction.invitation.updateMany({
        where: {
          id: invitation.id,
          organizationId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'REVOKED' },
      });
      if (revoked.count !== 1) {
        throw new ConflictException(
          'This invitation is no longer available to revoke.',
        );
      }
      await AuditLogsService.record(transaction, {
        organizationId,
        actorId: userId,
        action: 'INVITATION_REVOKED',
        targetType: 'INVITATION',
        targetId: invitation.id,
        before: { status: 'PENDING' },
        after: { status: 'REVOKED' },
      });
      return this.toInvitationResponse(invitation, 'REVOKED');
    });
  }

  async resendInvitation(
    organizationId: string,
    invitationId: string,
    userId: string,
  ): Promise<CreatedInvitation> {
    return this.withSerializableRetry(async (transaction) => {
      const access = await this.findAccess(transaction, organizationId, userId);
      this.assertCanManage(access.role);
      const invitation = await transaction.invitation.findFirst({
        where: { id: invitationId, organizationId },
        select: { ...invitationSelect, status: true },
      });
      if (!invitation) throw new NotFoundException('Invitation not found.');
      if (invitation.status !== 'PENDING') {
        throw new ConflictException('Only pending invitations can be resent.');
      }

      const now = new Date();
      if (invitation.expiresAt <= now) {
        throw new ConflictException('This invitation has expired.');
      }
      const invitationToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(now);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_LIFETIME_DAYS);
      const updated = await transaction.invitation.updateMany({
        where: {
          id: invitation.id,
          organizationId,
          status: 'PENDING',
          expiresAt: { gt: now },
        },
        data: {
          tokenHash: this.hashToken(invitationToken),
          expiresAt,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'This invitation is no longer available to resend.',
        );
      }

      const organization = await transaction.organization.findFirst({
        where: { id: organizationId, status: 'ACTIVE' },
        select: { name: true },
      });
      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }
      const refreshedInvitation = await transaction.invitation.findFirst({
        where: { id: invitation.id, organizationId },
        select: invitationSelect,
      });
      if (!refreshedInvitation) {
        throw new NotFoundException('Invitation not found.');
      }
      await AuditLogsService.record(transaction, {
        organizationId,
        actorId: userId,
        action: 'INVITATION_RESENT',
        targetType: 'INVITATION',
        targetId: invitation.id,
        before: { status: 'PENDING', expiresAt: invitation.expiresAt },
        after: { status: 'PENDING', expiresAt },
      });
      return {
        invitation: this.toInvitationResponse(refreshedInvitation),
        invitationToken,
        organizationName: organization.name,
      };
    });
  }

  async updateMemberRole(
    organizationId: string,
    memberUserId: string,
    actorUserId: string,
    input: UpdateMemberRoleDto,
  ): Promise<OrganizationMemberResponse> {
    return this.withSerializableRetry(async (transaction, publish) => {
      const access = await this.findAccess(
        transaction,
        organizationId,
        actorUserId,
      );
      this.assertCanManage(access.role);
      const member = await this.findActiveMember(
        transaction,
        organizationId,
        memberUserId,
      );
      this.assertNotOwner(member.role);

      const updated = await transaction.organizationMembership.updateMany({
        where: {
          organizationId,
          userId: memberUserId,
          status: 'ACTIVE',
          role: member.role,
        },
        data: { role: input.role },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'This membership changed before its role could be updated.',
        );
      }
      const updatedMember = await this.findActiveMember(
        transaction,
        organizationId,
        memberUserId,
      );
      if (member.role !== input.role && memberUserId !== actorUserId) {
        await publish([
          {
            recipientId: memberUserId,
            organizationId,
            type: 'TEAM_UPDATED',
            title: 'Organization role updated',
            message: `Your organization role is now ${input.role}.`,
            resourceType: 'ORGANIZATION',
            resourceId: organizationId,
            eventKey: `team-role:${randomUUID()}`,
          },
        ]);
      }
      if (member.role !== input.role) {
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: actorUserId,
          action: 'ORGANIZATION_MEMBER_ROLE_CHANGED',
          targetType: 'ORGANIZATION_MEMBER',
          targetId: memberUserId,
          before: { role: member.role },
          after: { role: input.role },
        });
      }
      return this.toMemberResponse(updatedMember);
    });
  }

  async removeMember(
    organizationId: string,
    memberUserId: string,
    actorUserId: string,
  ): Promise<{ userId: string; status: 'REMOVED' }> {
    return this.withSerializableRetry(async (transaction, publish) => {
      const access = await this.findAccess(
        transaction,
        organizationId,
        actorUserId,
      );
      this.assertCanManage(access.role);
      const member = await this.findActiveMember(
        transaction,
        organizationId,
        memberUserId,
      );
      this.assertNotOwner(member.role);

      const update = await transaction.organizationMembership.updateMany({
        where: {
          organizationId,
          userId: memberUserId,
          status: 'ACTIVE',
          role: { not: 'OWNER' },
        },
        data: { status: 'REMOVED' },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          'This membership changed before it could be removed.',
        );
      }
      await AuditLogsService.record(transaction, {
        organizationId,
        actorId: actorUserId,
        action: 'ORGANIZATION_MEMBER_REMOVED',
        targetType: 'ORGANIZATION_MEMBER',
        targetId: memberUserId,
        before: { role: member.role, status: 'ACTIVE' },
        after: { status: 'REMOVED' },
      });
      const activeProjectMemberships =
        await transaction.projectMember.findMany({
          where: {
            organizationId,
            userId: memberUserId,
            status: 'ACTIVE',
          },
          select: { id: true, status: true },
        });
      await transaction.projectMember.updateMany({
        where: {
          organizationId,
          userId: memberUserId,
          status: 'ACTIVE',
        },
        data: { status: 'REMOVED' },
      });
      for (const projectMembership of activeProjectMemberships) {
        await AuditLogsService.record(transaction, {
          organizationId,
          actorId: actorUserId,
          action: 'PROJECT_MEMBER_REMOVED',
          targetType: 'PROJECT_MEMBER',
          targetId: projectMembership.id,
          before: { status: projectMembership.status },
          after: { status: 'REMOVED' },
        });
      }

      if (memberUserId !== actorUserId) {
        await publish([
          {
            recipientId: memberUserId,
            organizationId,
            type: 'TEAM_UPDATED',
            title: 'Organization access removed',
            message: 'Your membership in this organization was removed.',
            resourceType: 'ORGANIZATION',
            resourceId: organizationId,
            eventKey: `team-removed:${randomUUID()}`,
          },
        ]);
      }

      return { userId: memberUserId, status: 'REMOVED' };
    });
  }

  async acceptInvitation(
    invitationToken: string,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<AcceptedInvitationResponse> {
    let stage = 'transaction_start';
    return this.withSerializableRetry(async (transaction) => {
      stage = 'invitation_lookup';
      const invitation = await transaction.invitation.findUnique({
        where: { tokenHash: this.hashToken(invitationToken) },
        select: acceptanceInvitationSelect,
      });
      if (!invitation) {
        throw new NotFoundException('Invitation not found.');
      }
      return this.completeInvitationAcceptance(
        transaction,
        invitation,
        userId,
        userEmail,
        userEmailVerified,
        (nextStage) => {
          stage = nextStage;
        },
      );
    }).catch((error: unknown) => {
      this.logInvitationAcceptanceFailure(error, stage);
      throw error;
    });
  }

  async getInvitationAcceptanceDetails(
    invitationId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<InvitationAcceptanceDetails> {
    if (!userEmailVerified) {
      throw new ForbiddenException(
        'Verify the email address on your NEXUS account before viewing this invitation.',
      );
    }
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: acceptanceInvitationSelect,
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (this.normalizeEmail(userEmail) !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'Sign in with the email address this invitation was sent to.',
      );
    }
    this.assertInvitationAvailable(invitation);
    return {
      id: invitation.id,
      organizationName: invitation.organization.name,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitationById(
    invitationId: string,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<AcceptedInvitationResponse> {
    let stage = 'transaction_start';
    return this.withSerializableRetry(async (transaction) => {
      stage = 'invitation_lookup';
      const invitation = await transaction.invitation.findUnique({
        where: { id: invitationId },
        select: acceptanceInvitationSelect,
      });
      if (!invitation) throw new NotFoundException('Invitation not found.');
      if (!userEmailVerified) {
        throw new ForbiddenException(
          'Verify the email address on your NEXUS account before accepting an invitation.',
        );
      }
      if (this.normalizeEmail(userEmail) !== invitation.email.toLowerCase()) {
        throw new ForbiddenException(
          'Sign in with the email address this invitation was sent to.',
        );
      }
      return this.completeInvitationAcceptance(
        transaction,
        invitation,
        userId,
        userEmail,
        userEmailVerified,
        (nextStage) => {
          stage = nextStage;
        },
      );
    }).catch((error: unknown) => {
      this.logInvitationAcceptanceFailure(error, stage);
      throw error;
    });
  }

  async declineInvitation(
    invitationToken: string,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<DeclinedInvitationResponse> {
    return this.withSerializableRetry((transaction) =>
      this.completeInvitationDecline(
        transaction,
        transaction.invitation.findUnique({
          where: { tokenHash: this.hashToken(invitationToken) },
          select: acceptanceInvitationSelect,
        }),
        userId,
        userEmail,
        userEmailVerified,
      ),
    );
  }

  async declineInvitationById(
    invitationId: string,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<DeclinedInvitationResponse> {
    return this.withSerializableRetry((transaction) =>
      this.completeInvitationDecline(
        transaction,
        transaction.invitation.findUnique({
          where: { id: invitationId },
          select: acceptanceInvitationSelect,
        }),
        userId,
        userEmail,
        userEmailVerified,
      ),
    );
  }

  private async completeInvitationDecline(
    transaction: Transaction,
    invitationPromise: Promise<AcceptanceInvitation | null>,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
  ): Promise<DeclinedInvitationResponse> {
    const invitation = await invitationPromise;
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (!userEmailVerified) {
      throw new ForbiddenException(
        'Verify the email address on your NEXUS account before declining an invitation.',
      );
    }
    if (this.normalizeEmail(userEmail) !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'Sign in with the email address this invitation was sent to.',
      );
    }
    this.assertInvitationAvailable(invitation);

    const declined = await transaction.invitation.updateMany({
      where: {
        id: invitation.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'DECLINED' },
    });
    if (declined.count !== 1) {
      throw new ConflictException('This invitation is no longer available.');
    }
    await AuditLogsService.record(transaction, {
      organizationId: invitation.organizationId,
      actorId: userId,
      action: 'INVITATION_DECLINED',
      targetType: 'INVITATION',
      targetId: invitation.id,
      before: { status: 'PENDING' },
      after: { status: 'DECLINED' },
    });
    return { organizationId: invitation.organizationId, status: 'DECLINED' };
  }

  private async completeInvitationAcceptance(
    transaction: Transaction,
    invitation: AcceptanceInvitation,
    userId: string,
    userEmail: string,
    userEmailVerified: boolean,
    setStage: (stage: string) => void,
  ): Promise<AcceptedInvitationResponse> {
    if (!userEmailVerified) {
      throw new ForbiddenException(
        'Verify the email address on your NEXUS account before accepting an invitation.',
      );
    }
    if (this.normalizeEmail(userEmail) !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'Sign in with the email address this invitation was sent to.',
      );
    }
    this.assertInvitationAvailable(invitation);

    setStage('membership_check');
    const existingMembership =
      await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
        select: { status: true },
      });
    if (existingMembership?.status === 'ACTIVE') {
      throw new ConflictException(
        'You are already a member of this organization.',
      );
    }
    if (existingMembership?.status === 'SUSPENDED') {
      throw new ConflictException(
        'Your organization membership is suspended.',
      );
    }
    const otherActiveMembership =
      await transaction.organizationMembership.findFirst({
        where: {
          organizationId: invitation.organizationId,
          userId: { not: userId },
          status: 'ACTIVE',
          user: {
            email: {
              equals: invitation.email,
              mode: 'insensitive',
            },
          },
        },
        select: { userId: true },
      });
    if (otherActiveMembership) {
      throw new ConflictException(
        'This invitation email already belongs to an organization member.',
      );
    }

    const claimed = await transaction.invitation.updateMany({
      where: {
        id: invitation.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This invitation is no longer available.');
    }

    setStage('membership_write');
    await transaction.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId,
        },
      },
      update: {
        role: invitation.intendedRole,
        status: 'ACTIVE',
      },
      create: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.intendedRole,
        status: 'ACTIVE',
      },
    });
    await AuditLogsService.record(transaction, {
      organizationId: invitation.organizationId,
      actorId: userId,
      action: 'INVITATION_ACCEPTED',
      targetType: 'INVITATION',
      targetId: invitation.id,
      before: { status: 'PENDING' },
      after: { status: 'ACCEPTED', role: invitation.intendedRole },
    });

    return {
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      role: invitation.intendedRole,
    };
  }

  private assertInvitationAvailable(
    invitation: AcceptanceInvitation,
  ): void {
    if (invitation.status === 'REVOKED') {
      throw new ConflictException('This invitation has been revoked.');
    }
    if (invitation.status === 'ACCEPTED') {
      throw new ConflictException('This invitation has already been used.');
    }
    if (invitation.status === 'DECLINED') {
      throw new ConflictException('This invitation has already been declined.');
    }
    if (
      invitation.status === 'EXPIRED' ||
      invitation.expiresAt <= new Date()
    ) {
      throw new ConflictException('This invitation has expired.');
    }
    if (invitation.organization.status !== 'ACTIVE') {
      throw new ConflictException(
        'Invitations for this organization are unavailable.',
      );
    }
  }

  private logInvitationAcceptanceFailure(
    error: unknown,
    stage: string,
  ): void {
    if (error instanceof HttpException) return;
    const category =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? `prisma_${error.code.toLowerCase()}`
        : 'unexpected_error';
    this.logger.error(
      `Invitation acceptance failed at ${stage}: ${category}`,
    );
  }

  private async listPendingInvitations(
    transaction: Transaction,
    organizationId: string,
    now: Date,
  ): Promise<InvitationRecord[]> {
    await transaction.invitation.updateMany({
      where: {
        organizationId,
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED' },
    });
    return transaction.invitation.findMany({
      where: {
        organizationId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      select: invitationSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findAccess(
    transaction: Transaction,
    organizationId: string,
    userId: string,
  ): Promise<TeamAccess> {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException('Organization not found.');
    }
    return membership;
  }

  private async findActiveMember(
    transaction: Transaction,
    organizationId: string,
    userId: string,
  ): Promise<MemberRecord> {
    const member = await transaction.organizationMembership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
      select: memberSelect,
    });
    if (!member) {
      throw new NotFoundException('Organization member not found.');
    }
    return member;
  }

  private async withSerializableRetry<T>(
    operation: (
      transaction: Transaction,
      publish: (notifications: NewNotification[]) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.notifications.withTransaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!this.isSerializationConflict(error)) {
          throw error;
        }
        if (attempt === SERIALIZABLE_RETRIES) {
          throw new ConflictException(
            'This team change conflicted with another request. Please try again.',
          );
        }
      }
    }
    throw new ConflictException('Unable to complete this team change.');
  }

  private isSerializationConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private canManage(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  private assertCanManage(role: OrganizationRole): void {
    if (!this.canManage(role)) {
      throw new ForbiddenException(
        'Only organization Owners and Admins can manage the team.',
      );
    }
  }

  private assertNotOwner(role: OrganizationRole): void {
    if (role === 'OWNER') {
      throw new ConflictException(
        'The organization Owner cannot be demoted or removed.',
      );
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toMemberResponse(member: MemberRecord): OrganizationMemberResponse {
    return {
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      joinedAt: member.createdAt,
    };
  }

  private toInvitationResponse(
    invitation: InvitationRecord,
    status: 'PENDING' | 'REVOKED' = 'PENDING',
  ): OrganizationInvitationResponse {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.intendedRole,
      status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }
}
