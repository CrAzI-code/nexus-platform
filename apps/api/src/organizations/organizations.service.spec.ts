import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { OrganizationsService } from './organizations.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  const transaction = {
    organization: { create: vi.fn() },
    organizationMembership: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
    organizationMembership: { findMany: vi.fn() },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organization.create.mockResolvedValue({
      id: 'organization-id',
      name: 'Acme Studio',
      slug: 'acme-studio',
    });
    transaction.organizationMembership.create.mockResolvedValue({
      role: 'OWNER',
    });
    prisma.organizationMembership.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(OrganizationsService);
  });

  it('creates an organization and OWNER membership in one transaction', async () => {
    await expect(
      service.create('verified-user-id', 'Acme Studio'),
    ).resolves.toEqual({
      id: 'organization-id',
      name: 'Acme Studio',
      slug: 'acme-studio',
      role: 'OWNER',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.organization.create).toHaveBeenCalledWith({
      data: { name: 'Acme Studio', slug: 'acme-studio' },
      select: { id: true, name: true, slug: true },
    });
    expect(transaction.organizationMembership.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'organization-id',
        userId: 'verified-user-id',
        role: 'OWNER',
      },
      select: { role: true },
    });
  });

  it('retries a colliding slug with a numeric suffix', async () => {
    const slugConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint conflict',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['slug'] },
      },
    );
    transaction.organization.create
      .mockRejectedValueOnce(slugConflict)
      .mockResolvedValueOnce({
        id: 'organization-id',
        name: 'Acme Studio',
        slug: 'acme-studio-2',
      });

    await expect(service.create('verified-user-id', 'Acme Studio')).resolves
      .toMatchObject({ slug: 'acme-studio-2', role: 'OWNER' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.organization.create).toHaveBeenNthCalledWith(2, {
      data: { name: 'Acme Studio', slug: 'acme-studio-2' },
      select: { id: true, name: true, slug: true },
    });
  });

  it('does not continue when membership creation fails inside the transaction', async () => {
    const failure = new Error('Membership insert failed');
    transaction.organizationMembership.create.mockRejectedValue(failure);

    await expect(
      service.create('verified-user-id', 'Acme Studio'),
    ).rejects.toBe(failure);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.organizationMembership.create).toHaveBeenCalled();
  });

  it('lists only active organizations for the verified user and includes each role', async () => {
    prisma.organizationMembership.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        organization: {
          id: 'organization-id',
          name: 'Acme Studio',
          slug: 'acme-studio',
        },
      },
    ]);

    await expect(service.listForUser('verified-user-id')).resolves.toEqual([
      {
        id: 'organization-id',
        name: 'Acme Studio',
        slug: 'acme-studio',
        role: 'OWNER',
      },
    ]);
    expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'verified-user-id',
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
  });

  it('returns a conflict if all bounded slug candidates are already taken', async () => {
    transaction.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint conflict', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['slug'] },
      }),
    );

    await expect(
      service.create('verified-user-id', 'Acme Studio'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(20);
  });
});
