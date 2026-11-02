import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkBackendService } from './clerk-backend.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';

describe('UserProvisioningService', () => {
  let service: UserProvisioningService;
  const clerkUser = {
    id: 'user_123',
    fullName: 'Casey Developer',
    username: 'casey',
    primaryEmailAddress: {
      emailAddress: 'casey@example.com',
      verification: { status: 'verified' },
    },
  };
  const internalUser = {
    id: 'internal-user-id',
    name: 'Casey Developer',
    email: 'casey@example.com',
    status: 'ACTIVE',
  };
  const authenticatedUser = {
    ...internalUser,
    primaryEmailVerified: true,
  };
  const transaction = {
    authIdentity: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    authIdentity: {
      findUnique: vi.fn(),
    },
  };
  const clerkBackend = {
    getUser: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    clerkBackend.getUser.mockResolvedValue(clerkUser);
    transaction.authIdentity.findUnique.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue(internalUser);
    transaction.authIdentity.create.mockResolvedValue({});
    transaction.user.update.mockResolvedValue(internalUser);
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProvisioningService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClerkBackendService, useValue: clerkBackend },
      ],
    }).compile();

    service = module.get(UserProvisioningService);
  });

  it('creates a NEXUS user and Clerk identity in the same transaction', async () => {
    await expect(service.provision('user_123')).resolves.toEqual(
      authenticatedUser,
    );

    expect(clerkBackend.getUser).toHaveBeenCalledWith('user_123');
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: { name: 'Casey Developer', email: 'casey@example.com' },
      select: { id: true, name: true, email: true, status: true },
    });
    expect(transaction.authIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'internal-user-id',
        provider: 'clerk',
        providerSubject: 'user_123',
      },
    });
  });

  it('updates the linked NEXUS user without creating another identity', async () => {
    transaction.authIdentity.findUnique.mockResolvedValue({
      userId: 'internal-user-id',
    });

    await expect(service.provision('user_123')).resolves.toEqual(
      authenticatedUser,
    );

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'internal-user-id' },
      data: { name: 'Casey Developer', email: 'casey@example.com' },
      select: { id: true, name: true, email: true, status: true },
    });
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.authIdentity.create).not.toHaveBeenCalled();
  });

  it('marks an unverified primary email without treating it as verified', async () => {
    clerkBackend.getUser.mockResolvedValue({
      ...clerkUser,
      primaryEmailAddress: {
        emailAddress: 'casey@example.com',
        verification: { status: 'unverified' },
      },
    });

    await expect(service.provision('user_123')).resolves.toMatchObject({
      ...internalUser,
      primaryEmailVerified: false,
    });
  });

  it('recovers from a concurrent identity insert without leaving a duplicate user', async () => {
    const uniqueConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint conflict',
      { code: 'P2002', clientVersion: 'test' },
    );
    prisma.$transaction
      .mockRejectedValueOnce(uniqueConflict)
      .mockImplementationOnce(
        (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      );
    prisma.authIdentity.findUnique.mockResolvedValue({
      userId: 'internal-user-id',
    });

    await expect(service.provision('user_123')).resolves.toEqual(
      authenticatedUser,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'internal-user-id' },
      data: { name: 'Casey Developer', email: 'casey@example.com' },
      select: { id: true, name: true, email: true, status: true },
    });
  });
});
