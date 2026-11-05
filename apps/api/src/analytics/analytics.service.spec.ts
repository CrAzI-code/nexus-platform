import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { AnalyticsService } from './analytics.service.js';

describe('AnalyticsService', () => {
  const prisma = {
    organizationMembership: { findFirst: vi.fn() },
    project: { findMany: vi.fn(), findFirst: vi.fn() },
    task: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    taskActivity: { findMany: vi.fn() },
    projectMember: { findMany: vi.fn() },
    taskBlocker: { count: vi.fn() },
    $queryRaw: vi.fn(),
  };
  let service: AnalyticsService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.organizationMembership.findFirst.mockResolvedValue({ role: 'MEMBER' });
    prisma.project.findMany.mockResolvedValue([
      { id: 'visible-project', name: 'Visible', status: 'ACTIVE' },
      { id: 'archived-project', name: 'Archived', status: 'ARCHIVED' },
    ]);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(1);
    prisma.taskActivity.findMany.mockResolvedValue([]);
    prisma.projectMember.findMany.mockResolvedValue([
      { userId: 'member-1', membership: { user: { name: 'Jordan' } } },
    ]);
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  it('limits organization analytics to visible projects and aggregates state', async () => {
    prisma.task.groupBy
      .mockResolvedValueOnce([
        { status: 'TODO', _count: { _all: 2 } },
        { status: 'BLOCKED', _count: { _all: 1 } },
        { status: 'DONE', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { projectId: 'visible-project', status: 'TODO', _count: { _all: 2 } },
        { projectId: 'visible-project', status: 'BLOCKED', _count: { _all: 1 } },
        { projectId: 'visible-project', status: 'DONE', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { assigneeId: 'member-1', status: 'TODO', _count: { _all: 2 } },
        { assigneeId: null, status: 'BLOCKED', _count: { _all: 1 } },
      ]);
    const result = await service.getOrganizationAnalytics(
      'organization-1',
      'member-1',
      { days: 30 },
    );

    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: 'organization-1',
        members: { some: { userId: 'member-1', status: 'ACTIVE' } },
      }),
    }));
    expect(result.projects).toEqual({ total: 2, active: 1 });
    expect(result.projectOptions).toHaveLength(2);
    expect(result.tasks).toEqual({
      total: 6,
      completed: 3,
      inProgress: 0,
      overdue: 1,
      blocked: 1,
    });
    expect(result.projectCompletion).toEqual([
      {
        id: 'visible-project',
        name: 'Visible',
        totalTasks: 6,
        completedTasks: 3,
        completionPercentage: 50,
      },
      {
        id: 'archived-project',
        name: 'Archived',
        totalTasks: 0,
        completedTasks: 0,
        completionPercentage: 0,
      },
    ]);
    expect(result.workload).toHaveLength(2);
  });

  it('does not query project analytics for non-members of a project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.getProjectAnalytics('organization-1', 'hidden-project', 'member-1', {
        days: 7,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.task.groupBy).not.toHaveBeenCalled();
  });

  it('returns project task, blocker, activity, and filtered workload analytics', async () => {
    prisma.project.findFirst.mockResolvedValue({
      id: 'visible-project',
      name: 'Visible',
      status: 'ACTIVE',
    });
    prisma.task.groupBy
      .mockResolvedValueOnce([
        { status: 'TODO', _count: { _all: 2 } },
        { status: 'DONE', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { assigneeId: 'member-1', status: 'BLOCKED', _count: { _all: 1 } },
      ]);
    prisma.task.count.mockResolvedValue(1);
    prisma.taskBlocker.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prisma.$queryRaw.mockResolvedValue([{ day: '2026-11-05', count: 4 }]);
    prisma.projectMember.findMany.mockResolvedValue([
      { userId: 'member-1', membership: { user: { name: 'Jordan' } } },
    ]);
    prisma.taskActivity.findMany.mockResolvedValue([
      {
        id: 'completion-event',
        createdAt: new Date('2026-11-05T10:00:00.000Z'),
        task: { title: 'Ship reporting' },
      },
    ]);
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'late-task',
        title: 'Review access rules',
        status: 'TODO',
        dueAt: new Date('2026-11-01T00:00:00.000Z'),
        assignee: { membership: { user: { name: 'Jordan' } } },
      },
    ]);

    const result = await service.getProjectAnalytics(
      'organization-1',
      'visible-project',
      'member-1',
      { days: 7, status: 'BLOCKED' },
    );

    expect(result.tasks).toEqual({
      total: 4,
      completed: 2,
      inProgress: 0,
      overdue: 1,
      blocked: 0,
      completionPercentage: 50,
    });
    expect(result.blockers).toEqual({ total: 5, unresolved: 2, resolved: 3 });
    expect(result.activityByDay).toHaveLength(7);
    expect(result.activityByDay.some((day) => day.count === 4)).toBe(true);
    expect(result.workload[0]).toMatchObject({ name: 'Jordan', blocked: 1, total: 1 });
    expect(result.recentlyCompleted[0]).toMatchObject({ title: 'Ship reporting' });
    expect(result.overdueWork[0]).toMatchObject({ title: 'Review access rules', assigneeName: 'Jordan' });
  });

  it('does not reveal analytics for organizations without active membership', async () => {
    prisma.organizationMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.getOrganizationAnalytics('other-organization', 'member-1', { days: 30 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });
});