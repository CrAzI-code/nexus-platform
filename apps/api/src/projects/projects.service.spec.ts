import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NewNotification } from '../notifications/notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    organizationMembership: { findFirst: vi.fn(), findMany: vi.fn() },
    project: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    projectMember: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    notification: { createMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
  };
  const notifications = {
    withTransaction: vi.fn(
      async <T>(
        operation: (
          tx: typeof transaction,
          publish: (items: NewNotification[]) => Promise<void>,
        ) => Promise<T>,
      ): Promise<T> =>
        prisma.$transaction((tx: typeof transaction) =>
          operation(tx, async (items) => {
            await tx.notification.createMany({
              data: items,
              skipDuplicates: true,
            });
          }),
        ),
    ),
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
    transaction.projectMember.findFirst.mockResolvedValue({
      id: 'project-member-id',
      status: 'ACTIVE',
    });
    transaction.projectMember.findUnique.mockResolvedValue(null);
    transaction.projectMember.upsert.mockResolvedValue({
      id: 'project-member-id',
      status: 'ACTIVE',
    });
    transaction.projectMember.updateMany.mockResolvedValue({ count: 1 });
    transaction.auditLog.create.mockResolvedValue({ id: 'audit-log-id' });
    transaction.organizationMembership.findMany.mockResolvedValue([]);
    transaction.projectMember.findMany.mockResolvedValue([]);
    transaction.notification.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
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
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          actorId: 'verified-user-id',
          action: 'PROJECT_CREATED',
          targetType: 'PROJECT',
          targetId: 'project-id',
        }),
      }),
    );
  });

  it('notifies other organization Owners and Admins when a project is created', async () => {
    transaction.organizationMembership.findMany.mockResolvedValue([
      { userId: 'admin-id' },
    ]);

    await service.create('organization-id', 'verified-user-id', {
      name: 'Roadmap',
    });

    expect(transaction.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          recipientId: 'admin-id',
          organizationId: 'organization-id',
          projectId: 'project-id',
          type: 'PROJECT_ADDED',
          resourceId: 'project-id',
        }),
      ],
      skipDuplicates: true,
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

    it('lists active project members and eligible active organization members for managers', async () => {
      transaction.organizationMembership.findMany.mockResolvedValue([
        {
          userId: 'eligible-user-id',
          role: 'MEMBER',
          user: { name: 'Eligible Member', email: 'eligible@example.com' },
        },
      ]);
      transaction.projectMember.findMany.mockResolvedValue([
        {
          userId: 'current-member-id',
          membership: {
            role: 'MANAGER',
            user: { name: 'Project Manager', email: 'manager@example.com' },
          },
        },
      ]);

      await expect(
        service.listMembers('organization-id', 'project-id', 'verified-user-id'),
      ).resolves.toEqual({
        members: [
          {
            userId: 'current-member-id',
            name: 'Project Manager',
            email: 'manager@example.com',
            role: 'MANAGER',
          },
        ],
        availableMembers: [
          {
            userId: 'eligible-user-id',
            name: 'Eligible Member',
            email: 'eligible@example.com',
            role: 'MEMBER',
          },
        ],
        canManage: true,
      });

      expect(transaction.organizationMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'organization-id',
            status: 'ACTIVE',
            projectMemberships: {
              none: { projectId: 'project-id', status: 'ACTIVE' },
            },
          },
        }),
      );
    });

    it('does not disclose the available organization-member list to project Members', async () => {
      transaction.organizationMembership.findFirst.mockResolvedValue({
        role: 'MEMBER',
      });
      transaction.projectMember.findMany.mockResolvedValue([]);

      await expect(
        service.listMembers('organization-id', 'project-id', 'verified-user-id'),
      ).resolves.toMatchObject({ availableMembers: [], canManage: false });
      expect(transaction.organizationMembership.findMany).not.toHaveBeenCalled();
    });

    it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
      'allows %s to add or reactivate an active organization member',
      async (role) => {
        transaction.organizationMembership.findFirst
          .mockResolvedValueOnce({ role })
          .mockResolvedValueOnce({
            userId: 'eligible-user-id',
            role: 'MEMBER',
            user: { name: 'Eligible Member', email: 'eligible@example.com' },
          });

        await expect(
          service.addMember(
            'organization-id',
            'project-id',
            'verified-user-id',
            'eligible-user-id',
          ),
        ).resolves.toEqual({
          userId: 'eligible-user-id',
          name: 'Eligible Member',
          email: 'eligible@example.com',
          role: 'MEMBER',
        });

        expect(transaction.projectMember.upsert).toHaveBeenCalledWith({
          where: {
            organizationId_projectId_userId: {
              organizationId: 'organization-id',
              projectId: 'project-id',
              userId: 'eligible-user-id',
            },
          },
          create: {
            organizationId: 'organization-id',
            projectId: 'project-id',
            userId: 'eligible-user-id',
            status: 'ACTIVE',
          },
          update: { status: 'ACTIVE' },
          select: { id: true, status: true },
        });
        expect(transaction.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              organizationId: 'organization-id',
              actorId: 'verified-user-id',
              action: 'PROJECT_MEMBER_ADDED',
              targetType: 'PROJECT_MEMBER',
            }),
          }),
        );
      },
    );

    it('prevents Members from adding project members', async () => {
      transaction.organizationMembership.findFirst.mockResolvedValue({
        role: 'MEMBER',
      });

      await expect(
        service.addMember(
          'organization-id',
          'project-id',
          'verified-user-id',
          'eligible-user-id',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('does not create another audit event when the member is already active', async () => {
      transaction.organizationMembership.findFirst
        .mockResolvedValueOnce({ role: 'OWNER' })
        .mockResolvedValueOnce({
          userId: 'eligible-user-id',
          role: 'MEMBER',
          user: { name: 'Eligible Member', email: 'eligible@example.com' },
        });
      transaction.projectMember.findUnique.mockResolvedValue({
        id: 'project-member-id',
        status: 'ACTIVE',
      });

      await service.addMember(
        'organization-id',
        'project-id',
        'verified-user-id',
        'eligible-user-id',
      );

      expect(transaction.auditLog.create).not.toHaveBeenCalled();
    });

    it('does not add someone without an active membership in this organization', async () => {
      transaction.organizationMembership.findFirst
        .mockResolvedValueOnce({ role: 'OWNER' })
        .mockResolvedValueOnce(null);

      await expect(
        service.addMember(
          'organization-id',
          'project-id',
          'verified-user-id',
          'outside-user-id',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transaction.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('removes membership without deleting the membership record', async () => {
      await expect(
        service.removeMember(
          'organization-id',
          'project-id',
          'verified-user-id',
          'member-user-id',
        ),
      ).resolves.toBeUndefined();
      expect(transaction.projectMember.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'organization-id',
          projectId: 'project-id',
          userId: 'member-user-id',
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
        },
        data: { status: 'REMOVED' },
      });
      expect(transaction.projectMember).not.toHaveProperty('delete');
      expect(transaction.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'verified-user-id',
            action: 'PROJECT_MEMBER_REMOVED',
            targetId: 'project-member-id',
          }),
        }),
      );
    });

    it('does not allow changing membership on archived projects', async () => {
      transaction.project.findFirst.mockResolvedValue({
        ...project,
        status: 'ARCHIVED',
      });

      await expect(
        service.addMember(
          'organization-id',
          'project-id',
          'verified-user-id',
          'eligible-user-id',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transaction.projectMember.upsert).not.toHaveBeenCalled();
    });

  it('allows an assigned Manager to update a project', async () => {
    transaction.organizationMembership.findFirst.mockResolvedValue({
      role: 'MANAGER',
    });
    transaction.project.findFirst
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ ...project, name: 'Updated Roadmap' });
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
        name: 'Roadmap',
      },
      data: { name: 'Updated Roadmap' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'organization-id',
          actorId: 'verified-user-id',
          action: 'PROJECT_UPDATED',
          targetId: 'project-id',
          before: { name: 'Roadmap' },
          after: { name: 'Updated Roadmap' },
        }),
      }),
    );
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
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PROJECT_ARCHIVED',
          actorId: 'verified-user-id',
          targetId: 'project-id',
        }),
      }),
    );
  });

  it('restores an archived project and audits the state transition', async () => {
    transaction.project.findFirst
      .mockResolvedValueOnce({ ...project, status: 'ARCHIVED' })
      .mockResolvedValueOnce(project);

    await expect(
      service.restore('organization-id', 'project-id', 'verified-user-id'),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    expect(transaction.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ARCHIVED' }),
        data: { status: 'ACTIVE' },
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PROJECT_RESTORED',
          actorId: 'verified-user-id',
          before: { status: 'ARCHIVED' },
          after: { status: 'ACTIVE' },
        }),
      }),
    );
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
