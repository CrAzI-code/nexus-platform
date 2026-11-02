import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user.js';
import { ClerkBackendService } from './clerk-backend.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

@Injectable()
export class ClerkAuthService {
  constructor(
    private readonly clerkBackend: ClerkBackendService,
    private readonly userProvisioning: UserProvisioningService,
  ) {}

  async authenticate(token: string): Promise<AuthenticatedUser> {
    const session = await this.clerkBackend.verifySessionToken(token);
    return this.userProvisioning.provision(session.subject);
  }
}
