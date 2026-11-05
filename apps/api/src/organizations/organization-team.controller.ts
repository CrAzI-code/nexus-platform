import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { BrevoEmailService } from '../email/brevo-email.service.js';
import {
  AcceptInvitationDto,
  AcceptInvitationPipe,
  CreateInvitationDto,
  CreateInvitationPipe,
  UpdateMemberRoleDto,
  UpdateMemberRolePipe,
} from './team.dto.js';
import {
  OrganizationTeamService,
  type AcceptedInvitationResponse,
  type CreatedInvitationResponse,
  type DeclinedInvitationResponse,
  type InvitationAcceptanceDetails,
  type OrganizationInvitationResponse,
  type OrganizationMemberResponse,
  type OrganizationTeamResponse,
} from './organization-team.service.js';

@Controller('organizations/:organizationId')
@UseGuards(ClerkAuthGuard)
export class OrganizationTeamController {
  constructor(
    private readonly team: OrganizationTeamService,
    private readonly email: BrevoEmailService,
  ) {}

  @Get('members')
  getTeam(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationTeamResponse> {
    return this.team.getTeam(organizationId, user.id);
  }

  @Post('invitations')
  invite(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateInvitationPipe) body: CreateInvitationDto,
  ): Promise<CreatedInvitationResponse> {
    return this.createInvitation(organizationId, user, body);
  }

  private async createInvitation(
    organizationId: string,
    user: AuthenticatedUser,
    body: CreateInvitationDto,
  ): Promise<CreatedInvitationResponse> {
    const created = await this.team.invite(
      organizationId,
      user.id,
      body.email,
      body.role,
    );
    const emailDeliveryStatus = await this.email.sendOrganizationInvitation({
      recipientEmail: created.invitation.email,
      organizationName: created.organizationName,
      inviterName: user.name.trim() || 'A NEXUS teammate',
      invitationToken: created.invitationToken,
      expiresAt: created.invitation.expiresAt,
    });

    return {
      invitation: created.invitation,
      invitationToken: created.invitationToken,
      emailDeliveryStatus,
    };
  }

  @Post('invitations/:invitationId/resend')
  async resendInvitation(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreatedInvitationResponse> {
    const created = await this.team.resendInvitation(
      organizationId,
      invitationId,
      user.id,
    );
    const emailDeliveryStatus = await this.email.sendOrganizationInvitation({
      recipientEmail: created.invitation.email,
      organizationName: created.organizationName,
      inviterName: user.name.trim() || 'A NEXUS teammate',
      invitationToken: created.invitationToken,
      expiresAt: created.invitation.expiresAt,
    });
    return {
      invitation: created.invitation,
      invitationToken: created.invitationToken,
      emailDeliveryStatus,
    };
  }

  @Delete('invitations/:invitationId')
  revokeInvitation(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationInvitationResponse> {
    return this.team.revokeInvitation(organizationId, invitationId, user.id);
  }

  @Patch('members/:memberUserId/role')
  updateMemberRole(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('memberUserId', ParseUUIDPipe) memberUserId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(UpdateMemberRolePipe) body: UpdateMemberRoleDto,
  ): Promise<OrganizationMemberResponse> {
    return this.team.updateMemberRole(
      organizationId,
      memberUserId,
      user.id,
      body,
    );
  }

  @Delete('members/:memberUserId')
  removeMember(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('memberUserId', ParseUUIDPipe) memberUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ userId: string; status: 'REMOVED' }> {
    return this.team.removeMember(organizationId, memberUserId, user.id);
  }
}

@Controller('invitations')
@UseGuards(ClerkAuthGuard)
export class InvitationAcceptanceController {
  constructor(private readonly team: OrganizationTeamService) {}

  @Get(':invitationId')
  getInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvitationAcceptanceDetails> {
    return this.team.getInvitationAcceptanceDetails(
      invitationId,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Post(':invitationId/accept')
  acceptById(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AcceptedInvitationResponse> {
    return this.team.acceptInvitationById(
      invitationId,
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Post(':invitationId/decline')
  declineById(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeclinedInvitationResponse> {
    return this.team.declineInvitationById(
      invitationId,
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Post('accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body(AcceptInvitationPipe) body: AcceptInvitationDto,
  ): Promise<AcceptedInvitationResponse> {
    return this.team.acceptInvitation(
      body.token,
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }

  @Post('decline')
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Body(AcceptInvitationPipe) body: AcceptInvitationDto,
  ): Promise<DeclinedInvitationResponse> {
    return this.team.declineInvitation(
      body.token,
      user.id,
      user.email,
      user.primaryEmailVerified === true,
    );
  }
}
