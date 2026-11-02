import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { ClerkBackendService } from './clerk-backend.service.js';

const CLERK_PROVIDER = 'clerk';

@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerkBackend: ClerkBackendService,
  ) {}

  async provision(clerkSubject: string): Promise<AuthenticatedUser> {
    const clerkUser = await this.clerkBackend.getUser(clerkSubject);
    const email = clerkUser.primaryEmailAddress?.emailAddress?.trim();
    const primaryEmailVerified =
      clerkUser.primaryEmailAddress?.verification?.status === 'verified';

    if (!email) {
      throw new UnprocessableEntityException(
        'A primary email address is required to provision this account.',
      );
    }

    const name =
      clerkUser.fullName?.trim() || clerkUser.username?.trim() || email;
    const profile = { name, email };
    const identityWhere = {
      provider_providerSubject: {
        provider: CLERK_PROVIDER,
        providerSubject: clerkSubject,
      },
    };

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const identity = await transaction.authIdentity.findUnique({
          where: identityWhere,
        });

        if (identity) {
          const user = await transaction.user.update({
            where: { id: identity.userId },
            data: profile,
            select: { id: true, name: true, email: true, status: true },
          });
          return { ...user, primaryEmailVerified };
        }

        const user = await transaction.user.create({
          data: profile,
          select: { id: true, name: true, email: true, status: true },
        });

        await transaction.authIdentity.create({
          data: {
            userId: user.id,
            provider: CLERK_PROVIDER,
            providerSubject: clerkSubject,
          },
        });

        return { ...user, primaryEmailVerified };
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      const existingIdentity = await this.prisma.authIdentity.findUnique({
        where: identityWhere,
      });
      if (!existingIdentity) {
        throw error;
      }

      return this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.update({
          where: { id: existingIdentity.userId },
          data: profile,
          select: { id: true, name: true, email: true, status: true },
        });
        return { ...user, primaryEmailVerified };
      });
    }
  }
}
