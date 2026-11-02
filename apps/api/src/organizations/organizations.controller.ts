import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateOrganizationDto,
  CreateOrganizationPipe,
} from './create-organization.dto.js';
import {
  OrganizationsService,
  type OrganizationMembershipResponse,
} from './organizations.service.js';

@Controller('organizations')
@UseGuards(ClerkAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(CreateOrganizationPipe) body: CreateOrganizationDto,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.create(user.id, body.name);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationMembershipResponse[]> {
    return this.organizations.listForUser(user.id);
  }
}
