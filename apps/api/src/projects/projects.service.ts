import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  OrganizationRole,
  ProjectStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import {
  NotificationsService,
  type NewNotification,
} from '../notifications/notifications.service.js';
import type { CreateProjectDto, UpdateProjectDto } from './project.dto.js';

const projectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      tasks: true,
      members: { where: { status: 'ACTIVE' } },
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{
  select: typeof projectSelect;
}>;

export interface ProjectResponse {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  taskCount: number;
  memberCount: number;
  canManage: boolean;
}

export interface ProjectMemberResponse {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
}

export interface ProjectMembersResponse {
  members: ProjectMemberResponse[];
  availableMembers: ProjectMemberResponse[];
  canManage: boolean;
}

type ActiveMembership = {
  role: OrganizationRole;
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateProjectDto,
  ): Promise<ProjectResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      this.assertCanCreate(membership.role);

      const project = await transaction.project.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
        },
        select: projectSelect,
      });

      await transaction.projectMember.create({
        data: {
          organizationId,
          projectId: project.id,
          userId,
          status: 'ACTIVE',
        },
      });

      const recipients = await transaction.organizationMembership.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'ADMIN'] },
          userId: { not: userId },
        },
        select: { userId: true },
      });
      await publish(
        recipients.map(({ userId: recipientId }) => ({
          recipientId,
          organizationId,
          projectId: project.id,
          type: 'PROJECT_ADDED',
          title: 'New project created',
          message: `A new project, "${project.name}", is ready.`,
          resourceType: 'PROJECT',
          resourceId: project.id,
          eventKey: `project-created:${project.id}:${recipientId}`,
        })),
      );

      return this.toResponse(project, membership.role);
    });
  }

  async list(
    organizationId: string,
    userId: string,
  ): Promise<ProjectResponse[]> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      const isPrivileged = this.isOwnerOrAdmin(membership.role);
      const projects = await transaction.project.findMany({
        where: {
          organizationId,
          ...(isPrivileged
            ? {}
            : {
                members: {
                  some: { userId, status: 'ACTIVE' },
                },
              }),
        },
        select: projectSelect,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      });

      return projects.map((project) => this.toResponse(project, membership.role));
    });
  }

  async get(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      const project = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );

      return this.toResponse(project, membership.role);
    });
  }

  async listMembers(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMembersResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );

      const canManage = this.canManage(membership.role);
      const [members, availableMembers] = await Promise.all([
        transaction.projectMember.findMany({
          where: {
            organizationId,
            projectId,
            status: 'ACTIVE',
            membership: { status: 'ACTIVE' },
          },
          select: {
            userId: true,
            membership: {
              select: {
                role: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        canManage
          ? transaction.organizationMembership.findMany({
              where: {
                organizationId,
                status: 'ACTIVE',
                projectMemberships: {
                  none: {
                    projectId,
                    status: 'ACTIVE',
                  },
                },
              },
              select: {
                userId: true,
                role: true,
                user: { select: { name: true, email: true } },
              },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
      ]);

      return {
        members: members.map((member) => ({
          userId: member.userId,
          name: member.membership.user.name,
          email: member.membership.user.email,
          role: member.membership.role,
        })),
        availableMembers: availableMembers.map((member) => ({
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          role: member.role,
        })),
        canManage,
      };
    });
  }

  async addMember(
    organizationId: string,
    projectId: string,
    actorId: string,
    memberUserId: string,
  ): Promise<ProjectMemberResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        actorId,
      );
      const project = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        actorId,
        membership.role,
      );
      this.assertCanManage(membership.role);
      this.assertProjectIsActive(project.status);

      const targetMembership =
        await transaction.organizationMembership.findFirst({
          where: {
            organizationId,
            userId: memberUserId,
            status: 'ACTIVE',
            organization: { status: 'ACTIVE' },
          },
          select: {
            userId: true,
            role: true,
            user: { select: { name: true, email: true } },
          },
        });
      if (!targetMembership) {
        throw new NotFoundException('Active organization member not found.');
      }

      await transaction.projectMember.upsert({
        where: {
          organizationId_projectId_userId: {
            organizationId,
            projectId,
            userId: memberUserId,
          },
        },
        create: {
          organizationId,
          projectId,
          userId: memberUserId,
          status: 'ACTIVE',
        },
        update: { status: 'ACTIVE' },
      });

      return {
        userId: targetMembership.userId,
        name: targetMembership.user.name,
        email: targetMembership.user.email,
        role: targetMembership.role,
      };
    });
  }

  async removeMember(
    organizationId: string,
    projectId: string,
    actorId: string,
    memberUserId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        actorId,
      );
      const project = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        actorId,
        membership.role,
      );
      this.assertCanManage(membership.role);
      this.assertProjectIsActive(project.status);

      const result = await transaction.projectMember.updateMany({
        where: {
          organizationId,
          projectId,
          userId: memberUserId,
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
        },
        data: { status: 'REMOVED' },
      });
      if (result.count !== 1) {
        throw new NotFoundException('Active project member not found.');
      }
    });
  }

  async update(
    organizationId: string,
    projectId: string,
    userId: string,
    input: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      const project = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );
      this.assertCanManage(membership.role);
      if (project.status === 'ARCHIVED') {
        throw new ConflictException('Archived projects cannot be edited.');
      }

      await transaction.project.updateMany({
        where: {
          id: projectId,
          organizationId,
          status: 'ACTIVE',
        },
        data: input,
      });
      const updatedProject = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );

      if (
        (input.name !== undefined && input.name !== project.name) ||
        (input.description !== undefined &&
          input.description !== project.description)
      ) {
        await this.notifyProjectMembers(
          transaction,
          publish,
          organizationId,
          projectId,
          userId,
          randomUUID(),
          'Project updated',
          `"${updatedProject.name}" has new project details.`,
        );
      }

      return this.toResponse(updatedProject, membership.role);
    });
  }

  async archive(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectResponse> {
    return this.notifications.withTransaction(async (transaction, publish) => {
      const membership = await this.findActiveMembership(
        transaction,
        organizationId,
        userId,
      );
      const project = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );
      this.assertCanManage(membership.role);

      const wasActive = project.status === 'ACTIVE';
      if (wasActive) {
        await transaction.project.updateMany({
          where: {
            id: projectId,
            organizationId,
            status: 'ACTIVE',
          },
          data: { status: 'ARCHIVED' },
        });
      }

      const archivedProject = await this.findAccessibleProject(
        transaction,
        organizationId,
        projectId,
        userId,
        membership.role,
      );
      if (wasActive) {
        await this.notifyProjectMembers(
          transaction,
          publish,
          organizationId,
          projectId,
          userId,
          randomUUID(),
          'Project archived',
          `"${archivedProject.name}" was archived.`,
        );
      }
      return this.toResponse(archivedProject, membership.role);
    });
  }

  private async findActiveMembership(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
  ): Promise<ActiveMembership> {
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

  private async findAccessibleProject(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<ProjectRecord> {
    const project = await transaction.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        ...(this.isOwnerOrAdmin(role)
          ? {}
          : {
              members: {
                some: { userId, status: 'ACTIVE' },
              },
            }),
      },
      select: projectSelect,
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  private assertCanCreate(role: OrganizationRole): void {
    if (role === 'MEMBER') {
      throw new ForbiddenException(
        'Only Owners, Admins, and Managers can create projects.',
      );
    }
  }

  private assertCanManage(role: OrganizationRole): void {
    if (role === 'MEMBER') {
      throw new ForbiddenException(
        'Only Owners, Admins, and Managers can manage projects.',
      );
    }
  }

  private canManage(role: OrganizationRole): boolean {
    return role !== 'MEMBER';
  }

  private assertProjectIsActive(status: ProjectStatus): void {
    if (status === 'ARCHIVED') {
      throw new ConflictException(
        'Archived projects cannot change their members.',
      );
    }
  }

  private isOwnerOrAdmin(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  private async notifyProjectMembers(
    transaction: Prisma.TransactionClient,
    publish: (notifications: NewNotification[]) => Promise<void>,
    organizationId: string,
    projectId: string,
    actorId: string,
    eventId: string,
    title: string,
    message: string,
  ): Promise<void> {
    const members = await transaction.projectMember.findMany({
      where: {
        organizationId,
        projectId,
        userId: { not: actorId },
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
      },
      select: { userId: true },
    });
    await publish(
      members.map(({ userId: recipientId }) => ({
        recipientId,
        organizationId,
        projectId,
        type: 'PROJECT_UPDATED',
        title,
        message,
        resourceType: 'PROJECT',
        resourceId: projectId,
        eventKey: `project-updated:${eventId}:${recipientId}`,
      })),
    );
  }

  private toResponse(
    project: ProjectRecord,
    role: OrganizationRole,
  ): ProjectResponse {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      taskCount: project._count.tasks,
      memberCount: project._count.members,
      canManage: this.isOwnerOrAdmin(role) || role === 'MANAGER',
    };
  }
}
