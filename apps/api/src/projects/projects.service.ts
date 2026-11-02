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

type ActiveMembership = {
  role: OrganizationRole;
};

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateProjectDto,
  ): Promise<ProjectResponse> {
    return this.prisma.$transaction(async (transaction) => {
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

  async update(
    organizationId: string,
    projectId: string,
    userId: string,
    input: UpdateProjectDto,
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

      return this.toResponse(updatedProject, membership.role);
    });
  }

  async archive(
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
      this.assertCanManage(membership.role);

      if (project.status === 'ACTIVE') {
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

  private isOwnerOrAdmin(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN';
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
