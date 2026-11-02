import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service.js';
import { ProjectsService } from './projects.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ProjectsService', () => {
  let service: ProjectsService;
  const project = {
    id: 'project-id',
    name: 'Roadmap',
    description: 'Planning',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    _count: { tasks: 4, members: 2 },
  };
  const transaction = {
    organizationMembership: { findFirst: vi.fn() },
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    projectMember: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'OWNER',
    });
    transaction.project.create.mockResolvedValue(project);
    transaction.project.findMany.mockResolvedValue([project]);
    transaction.project.findFirst.mockResolvedValue(project);
    transaction.project.updateMany.mockResolvedValue({ count: 1 });
    transaction.projectMember.create.mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  it('creates a project and active creator membership in one transaction', async () => {
    await expect(
      service.create('organization-id', 'verified-user-id', {
        name: 'Roadmap',
        description: 'Planning',
      }),
    ).resolves.toMatchObject({
      id: 'project-id',
      name: 'Roadmap',
      status: 'ACTIVE',
      canManage: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.organizationMembership.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-id',
        userId: 'verified-user-id',
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { role: true },
    });
    expect(transaction.project.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'organization-id',
        name: 'Roadmap',
        description: 'Planning',
      },
      select: expect.any(Object),
    });
    expect(transaction.projectMember.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'organization-id',
        projectId: 'project-id',
        userId: 'verified-user-id',
        status: 'ACTIVE',
      },
    });
  });

  it('rolls back project creation when automatic membership creation fails', async () => {
    const failure = new Error('Membership insert failed');
    transaction.projectMember.create.mockRejectedValue(failure);

    await expect(
      service.create('organization-id', 'verified-user-id', {
        name: 'Roadmap',
      }),
    ).rejects.toBe(failure);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.project.create).toHaveBeenCalled();
    expect(transaction.projectMember.create).toHaveBeenCalled();
  });

  it('does not create projects for members', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      service.create('organization-id', 'verified-user-id', {
        name: 'Roadmap',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.project.create).not.toHaveBeenCalled();
    expect(transaction.projectMember.create).not.toHaveBeenCalled();
  });

  it('denies project creation for users without an active organization membership', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.create('another-organization', 'verified-user-id', {
        name: 'Roadmap',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.project.create).not.toHaveBeenCalled();
  });

  it('lists every project for Owners and Admins', async () => {
    await service.list('organization-id', 'verified-user-id');

    expect(transaction.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'organization-id' },
      }),
    );
  });

  it('limits Manager and Member project listings to active project assignments', async () => {
    for (const role of ['MANAGER', 'MEMBER'] as const) {
      transaction.organizationMembership.findFirst.mockResolvedValue({ role });
      await service.list('organization-id', 'verified-user-id');
    }

    expect(transaction.project.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'organization-id',
          members: {
            some: { userId: 'verified-user-id', status: 'ACTIVE' },
          },
        },
      }),
    );
  });

  it('returns an assigned project to a member', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      service.get('organization-id', 'project-id', 'verified-user-id'),
    ).resolves.toMatchObject({ id: 'project-id', canManage: false });
    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'project-id',
          organizationId: 'organization-id',
          members: {
            some: { userId: 'verified-user-id', status: 'ACTIVE' },
          },
        },
      }),
    );
  });

  it('hides projects in other organizations and projects not assigned to a member', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.get('another-organization', 'project-id', 'verified-user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'project-id',
          organizationId: 'another-organization',
        }),
      }),
    );
  });

  it('hides a project that the active organization member is not assigned to', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });
    transaction.project.findFirst.mockResolvedValue(null);

    await expect(
      service.get('organization-id', 'unassigned-project', 'verified-user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'unassigned-project',
          organizationId: 'organization-id',
          members: {
            some: { userId: 'verified-user-id', status: 'ACTIVE' },
          },
        },
      }),
    );
  });

  it('allows an assigned Manager to update a project', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
    });
    transaction.project.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.update('organization-id', 'project-id', 'verified-user-id', {
        name: 'Updated Roadmap',
      }),
    ).resolves.toMatchObject({ id: 'project-id', canManage: true });

    expect(transaction.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'project-id',
        organizationId: 'organization-id',
        status: 'ACTIVE',
      },
      data: { name: 'Updated Roadmap' },
    });
  });

  it('prevents an assigned Member from updating a project', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      service.update('organization-id', 'project-id', 'verified-user-id', {
        name: 'Not allowed',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.project.updateMany).not.toHaveBeenCalled();
  });

  it('archives rather than deletes a project', async () => {
    await expect(
      service.archive('organization-id', 'project-id', 'verified-user-id'),
    ).resolves.toMatchObject({ id: 'project-id' });

    expect(transaction.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'project-id',
        organizationId: 'organization-id',
        status: 'ACTIVE',
      },
      data: { status: 'ARCHIVED' },
    });
    expect(transaction.project).not.toHaveProperty('delete');
  });

  it('does not change archived projects on repeated archive requests', async () => {
    transaction.project.findFirst.mockResolvedValue({
      ...project,
      status: 'ARCHIVED',
    });

    await expect(
      service.archive('organization-id', 'project-id', 'verified-user-id'),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });
    expect(transaction.project.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow editing an archived project', async () => {
    transaction.project.findFirst.mockResolvedValue({
      ...project,
      status: 'ARCHIVED',
    });

    await expect(
      service.update('organization-id', 'project-id', 'verified-user-id', {
        name: 'Updated',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.project.updateMany).not.toHaveBeenCalled();
  });
});
