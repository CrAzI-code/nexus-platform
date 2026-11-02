import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';

const MAX_SLUG_ATTEMPTS = 20;
const MAX_SLUG_LENGTH = 72;

export interface OrganizationMembershipResponse {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    name: string,
  ): Promise<OrganizationMembershipResponse> {
    const baseSlug = this.createSlug(name);

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug =
        attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;

      try {
        return await this.prisma.$transaction(async (transaction) => {
          const organization = await transaction.organization.create({
            data: { name, slug },
            select: { id: true, name: true, slug: true },
          });
          const membership =
            await transaction.organizationMembership.create({
              data: {
                organizationId: organization.id,
                userId,
                role: 'OWNER',
              },
              select: { role: true },
            });

          return { ...organization, role: membership.role };
        });
      } catch (error) {
        if (!this.isSlugConflict(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'Unable to create a unique organization URL. Please try again.',
    );
  }

  async listForUser(
    userId: string,
  ): Promise<OrganizationMembershipResponse[]> {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: {
        role: true,
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map(({ organization, role }) => ({
      ...organization,
      role,
    }));
  }

  private createSlug(name: string): string {
    const slug = name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/gu, '');

    return slug || 'organization';
  }

  private isSlugConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const targetDescription = Array.isArray(target)
      ? target.join(' ')
      : typeof target === 'string'
        ? target
        : '';

    return targetDescription.toLowerCase().includes('slug');
  }
}
