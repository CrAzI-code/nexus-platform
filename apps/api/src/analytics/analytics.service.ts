import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  OrganizationRole,
  TaskStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import type { AnalyticsQuery } from './analytics.dto.js';

const DAY_MS = 86_400_000;

type StatusGroup = { status: TaskStatus; _count: { _all: number } };
type ProjectStatusGroup = {
  projectId: string;
  status: TaskStatus;
  _count: { _all: number };
};

export type AnalyticsActivity = {
  id: string;
  eventType: string;
  message: string;
  actorName: string;
  taskTitle: string;
  projectName: string;
  createdAt: Date;
};

export type AnalyticsWorkload = {
  userId: string | null;
  name: string;
  total: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
};

export type OrganizationAnalyticsResponse = {
  projects: { total: number; active: number };
  tasks: { total: number; completed: number; inProgress: number; overdue: number; blocked: number };
  projectOptions: { id: string; name: string; status: 'ACTIVE' | 'ARCHIVED' }[];
  projectCompletion: {
    id: string;
    name: string;
    totalTasks: number;
    completedTasks: number;
    completionPercentage: number;
  }[];
  recentActivity: AnalyticsActivity[];
  workload: AnalyticsWorkload[];
};

export type ProjectAnalyticsResponse = {
  project: { id: string; name: string; status: 'ACTIVE' | 'ARCHIVED' };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    overdue: number;
    blocked: number;
    completionPercentage: number;
  };
  blockers: { total: number; unresolved: number; resolved: number };
  activityByDay: { date: string; count: number }[];
  workload: AnalyticsWorkload[];
  recentlyCompleted: { id: string; title: string; completedAt: Date }[];
  overdueWork: {
    id: string;
    title: string;
    status: TaskStatus;
    dueAt: Date;
    assigneeName: string | null;
  }[];
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrganizationAnalytics(
    organizationId: string,
    userId: string,
    query: AnalyticsQuery,
  ): Promise<OrganizationAnalyticsResponse> {
    const membership = await this.findMembership(organizationId, userId);
    const privileged = this.isPrivileged(membership.role);
    const visibleProjects = await this.prisma.project.findMany({
      where: {
        organizationId,
        ...(privileged ? {} : { members: { some: { userId, status: 'ACTIVE' } } }),
      },
      select: { id: true, name: true, status: true },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    if (query.projectId && !visibleProjects.some((project) => project.id === query.projectId)) {
      throw new NotFoundException('Project not found.');
    }
    const projects = query.projectId
      ? visibleProjects.filter((project) => project.id === query.projectId)
      : visibleProjects;

    const activeProjects = projects.filter((project) => project.status === 'ACTIVE');
    const projectIds = projects.map((project) => project.id);
    const activeProjectIds = activeProjects.map((project) => project.id);
    const taskWhere: Prisma.TaskWhereInput = {
      organizationId,
      projectId: { in: projectIds },
      archivedAt: null,
    };
    const activitySince = getPeriodStart(query.days);
    const [statusGroups, projectGroups, overdue, recentActivity, workload] =
      await Promise.all([
        projectIds.length
          ? this.prisma.task.groupBy({
              by: ['status'],
              where: taskWhere,
              _count: { _all: true },
            })
          : Promise.resolve([] as StatusGroup[]),
        projectIds.length
          ? this.prisma.task.groupBy({
              by: ['projectId', 'status'],
              where: taskWhere,
              _count: { _all: true },
            })
          : Promise.resolve([] as ProjectStatusGroup[]),
        projectIds.length
          ? this.prisma.task.count({
              where: {
                ...taskWhere,
                dueAt: { lt: startOfToday() },
                status: { not: 'DONE' },
              },
            })
          : Promise.resolve(0),
        projectIds.length
          ? this.getRecentActivity(organizationId, projectIds, activitySince)
          : Promise.resolve([]),
        activeProjectIds.length
          ? this.getOrganizationWorkload(organizationId, activeProjectIds)
          : Promise.resolve([]),
      ]);

    const totals = countStatuses(statusGroups);
    const countsByProject = new Map<string, Record<TaskStatus, number>>();
    for (const group of projectGroups) {
      const current = countsByProject.get(group.projectId) ?? emptyStatusCounts();
      current[group.status] = group._count._all;
      countsByProject.set(group.projectId, current);
    }

    return {
      projects: {
        total: projects.length,
        active: activeProjects.length,
      },
      tasks: {
        total: totals.total,
        completed: totals.completed,
        inProgress: totals.inProgress,
        overdue,
        blocked: totals.blocked,
      },
      projectOptions: visibleProjects,
      projectCompletion: projects.map((project) => {
        const counts = countsByProject.get(project.id) ?? emptyStatusCounts();
        const totalTasks = counts.TODO + counts.IN_PROGRESS + counts.BLOCKED + counts.DONE;
        return {
          id: project.id,
          name: project.name,
          totalTasks,
          completedTasks: counts.DONE,
          completionPercentage: percentage(counts.DONE, totalTasks),
        };
      }),
      recentActivity,
      workload,
    };
  }

  async getProjectAnalytics(
    organizationId: string,
    projectId: string,
    userId: string,
    query: AnalyticsQuery,
  ): Promise<ProjectAnalyticsResponse> {
    const membership = await this.findMembership(organizationId, userId);
    const project = await this.prisma.project.findFirst({
      where: {
        organizationId,
        id: projectId,
        ...(this.isPrivileged(membership.role)
          ? {}
          : { members: { some: { userId, status: 'ACTIVE' } } }),
      },
      select: { id: true, name: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found.');

    const taskWhere: Prisma.TaskWhereInput = {
      organizationId,
      projectId,
      archivedAt: null,
    };
    const since = getPeriodStart(query.days);
    const [statusGroups, overdue, unresolvedBlockers, resolvedBlockers, activityByDay, workload, recentlyCompleted, overdueWork] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['status'],
        where: taskWhere,
        _count: { _all: true },
      }),
      this.prisma.task.count({
        where: {
          ...taskWhere,
          dueAt: { lt: startOfToday() },
          status: { not: 'DONE' },
        },
      }),
      this.prisma.taskBlocker.count({
        where: { organizationId, projectId, resolvedAt: null, task: { archivedAt: null } },
      }),
      this.prisma.taskBlocker.count({
        where: { organizationId, projectId, resolvedAt: { not: null }, task: { archivedAt: null } },
      }),
      this.getActivityByDay(organizationId, projectId, since),
      this.getProjectWorkload(organizationId, projectId, query.status),
      this.prisma.taskActivity.findMany({
        where: {
          organizationId,
          projectId,
          type: 'STATUS_CHANGED',
          message: { contains: ' to DONE.' },
          createdAt: { gte: since },
          task: { archivedAt: null },
        },
        select: { id: true, message: true, createdAt: true, task: { select: { title: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
      this.prisma.task.findMany({
        where: {
          ...taskWhere,
          dueAt: { lt: startOfToday() },
          status: { not: 'DONE' },
        },
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          assignee: { select: { membership: { select: { user: { select: { name: true } } } } } },
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 8,
      }),
    ]);

    const totals = countStatuses(statusGroups);
    return {
      project,
      tasks: {
        total: totals.total,
        completed: totals.completed,
        inProgress: totals.inProgress,
        overdue,
        blocked: totals.blocked,
        completionPercentage: percentage(totals.completed, totals.total),
      },
      blockers: {
        total: unresolvedBlockers + resolvedBlockers,
        unresolved: unresolvedBlockers,
        resolved: resolvedBlockers,
      },
      activityByDay,
      workload,
      recentlyCompleted: recentlyCompleted.map((activity) => ({
        id: activity.id,
        title: activity.task.title,
        completedAt: activity.createdAt,
      })),
      overdueWork: overdueWork.flatMap((task) => task.dueAt ? [{
        id: task.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        assigneeName: task.assignee?.membership.user.name ?? null,
      }] : []),
    };
  }

  private async findMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership;
  }

  private isPrivileged(role: OrganizationRole): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  private async getRecentActivity(
    organizationId: string,
    projectIds: string[],
    since: Date,
  ): Promise<AnalyticsActivity[]> {
    const rows = await this.prisma.taskActivity.findMany({
      where: { organizationId, projectId: { in: projectIds }, createdAt: { gte: since } },
      select: {
        id: true,
        type: true,
        message: true,
        createdAt: true,
        task: { select: { title: true, project: { select: { name: true } } } },
        actor: { select: { membership: { select: { user: { select: { name: true } } } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 12,
    });
    return rows.map((row) => ({
      id: row.id,
      eventType: row.type,
      message: row.message,
      actorName: row.actor.membership.user.name,
      taskTitle: row.task.title,
      projectName: row.task.project.name,
      createdAt: row.createdAt,
    }));
  }

  private async getOrganizationWorkload(
    organizationId: string,
    projectIds: string[],
  ): Promise<AnalyticsWorkload[]> {
    const [members, assignments] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: {
          organizationId,
          projectId: { in: projectIds },
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
        },
        select: { userId: true, membership: { select: { user: { select: { name: true } } } } },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId', 'status'],
        where: {
          organizationId,
          projectId: { in: projectIds },
          archivedAt: null,
          status: { not: 'DONE' },
        },
        _count: { _all: true },
      }),
    ]);
    const workload = new Map<string, AnalyticsWorkload>();
    for (const member of members) {
      if (!workload.has(member.userId)) {
        workload.set(member.userId, emptyWorkload(member.userId, member.membership.user.name));
      }
    }
    for (const assignment of assignments) {
      const userId = assignment.assigneeId;
      const entry = userId
        ? workload.get(userId) ?? emptyWorkload(userId, 'Project member')
        : workload.get('unassigned') ?? emptyWorkload(null, 'Unassigned');
      applyWorkloadCount(entry, assignment.status, assignment._count._all);
      workload.set(userId ?? 'unassigned', entry);
    }
    return [...workload.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  }

  private async getProjectWorkload(
    organizationId: string,
    projectId: string,
    status?: TaskStatus,
  ): Promise<AnalyticsWorkload[]> {
    const [members, assignments] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { organizationId, projectId, status: 'ACTIVE', membership: { status: 'ACTIVE' } },
        select: { userId: true, membership: { select: { user: { select: { name: true } } } } },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId', 'status'],
        where: {
          organizationId,
          projectId,
          archivedAt: null,
          ...(status ? { status } : { status: { not: 'DONE' } }),
        },
        _count: { _all: true },
      }),
    ]);
    const workload = new Map<string, AnalyticsWorkload>();
    for (const member of members) {
      workload.set(member.userId, emptyWorkload(member.userId, member.membership.user.name));
    }
    for (const assignment of assignments) {
      const userId = assignment.assigneeId;
      const entry = userId
        ? workload.get(userId) ?? emptyWorkload(userId, 'Project member')
        : workload.get('unassigned') ?? emptyWorkload(null, 'Unassigned');
      applyWorkloadCount(entry, assignment.status, assignment._count._all);
      workload.set(userId ?? 'unassigned', entry);
    }
    return [...workload.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  }

  private async getActivityByDay(
    organizationId: string,
    projectId: string,
    since: Date,
  ): Promise<{ date: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ day: string; count: bigint | number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', "created_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "count"
      FROM "task_activities"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "project_id" = ${projectId}::uuid
        AND "created_at" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    const counts = new Map(rows.map((row) => [row.day, Number(row.count)]));
    return Array.from({ length: Math.floor((Date.now() - since.getTime()) / DAY_MS) + 1 }, (_, index) => {
      const date = new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10);
      return { date, count: counts.get(date) ?? 0 };
    });
  }
}

function emptyStatusCounts(): Record<TaskStatus, number> {
  return { TODO: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
}

function countStatuses(groups: StatusGroup[]): Record<TaskStatus, number> & { total: number; completed: number; inProgress: number; blocked: number } {
  const counts = emptyStatusCounts();
  for (const group of groups) counts[group.status] = group._count._all;
  const total = counts.TODO + counts.IN_PROGRESS + counts.BLOCKED + counts.DONE;
  return { ...counts, total, completed: counts.DONE, inProgress: counts.IN_PROGRESS, blocked: counts.BLOCKED };
}

function percentage(completed: number, total: number): number {
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}

function emptyWorkload(userId: string | null, name: string): AnalyticsWorkload {
  return { userId, name, total: 0, todo: 0, inProgress: 0, blocked: 0, done: 0 };
}

function applyWorkloadCount(entry: AnalyticsWorkload, status: TaskStatus, count: number): void {
  entry.total += count;
  if (status === 'TODO') entry.todo += count;
  if (status === 'IN_PROGRESS') entry.inProgress += count;
  if (status === 'BLOCKED') entry.blocked += count;
  if (status === 'DONE') entry.done += count;
}

function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function getPeriodStart(days: number): Date {
  const start = startOfToday();
  start.setUTCDate(start.getUTCDate() - days + 1);
  return start;
}