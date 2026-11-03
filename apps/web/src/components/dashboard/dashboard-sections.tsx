"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Task, TaskPriority, TaskStatus } from "./dashboard-data";
import {
  formatDueDate,
  formatRelativeTime,
  getAuditActivity,
  getProjectProgress,
  getTaskSummary,
  isOverdue,
} from "./dashboard-data";
import { Icon } from "./icons";
import type { OrganizationProject } from "@/lib/organizations";
import type { AuditLogItem } from "@/lib/audit-logs";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/ui/feedback";

type OverviewSectionProps = {
  tasks: Task[];
  projects: OrganizationProject[];
  memberCount: number | null;
  isProjectsLoading: boolean;
  isTasksLoading: boolean;
  isMembersLoading: boolean;
};

export function OverviewSection({
  tasks,
  projects,
  memberCount,
  isProjectsLoading,
  isTasksLoading,
  isMembersLoading,
}: OverviewSectionProps) {
  const summary = getTaskSummary(tasks);
  const cards = [
    {
      label: "Projects",
      value: projects.filter((project) => project.status === "ACTIVE").length,
      note: "Active in this organization",
      icon: "briefcase" as const,
      tone: "brand",
      isLoading: isProjectsLoading,
    },
    {
      label: "Tasks",
      value: summary.total,
      note: "Across projects you can access",
      icon: "check-square" as const,
      tone: "success",
      isLoading: isTasksLoading,
    },
    {
      label: "Team members",
      value: memberCount ?? "—",
      note: memberCount === null ? "Member count is unavailable" : "People in this organization",
      icon: "users" as const,
      tone: "blue",
      isLoading: isMembersLoading,
    },
    {
      label: "Overdue tasks",
      value: summary.overdue,
      note: summary.overdue === 0 ? "Everything is on track" : "Needs your attention",
      icon: "calendar" as const,
      tone: summary.overdue > 0 ? "danger" : "warning",
      isLoading: isTasksLoading,
    },
  ];

  return (
    <section aria-label="Organization overview" className="overview-section">
      <div className="overview-grid">
        {cards.map((card) => (
          <article className="stat-card" key={card.label}>
            <span className={`stat-icon ${card.tone}`}>
              <Icon name={card.icon} width={19} height={19} />
            </span>
            <div className="stat-copy">
              {card.isLoading ? <span className="stat-value-skeleton" /> : <strong>{card.value}</strong>}
              <span>{card.label}</span>
              <p>{card.note}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type ProjectsSectionProps = {
  organizationId: string;
  projects: OrganizationProject[];
  tasks: Task[];
  search: string;
  canCreate: boolean;
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (project: OrganizationProject) => void;
  onArchive: (project: OrganizationProject) => void;
  onRetry: () => void;
};

export function ProjectsSection({
  organizationId,
  projects,
  tasks,
  search,
  canCreate,
  isLoading,
  error,
  onCreate,
  onEdit,
  onArchive,
  onRetry,
}: ProjectsSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const filteredProjects = projects.filter((project) =>
    `${project.name} ${project.description ?? ""} ${project.status}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleProjects =
    search || showAll ? filteredProjects : filteredProjects.slice(0, 4);

  return (
    <section aria-labelledby="projects-title" className="surface-card section-card" id="projects">
      <div className="section-heading">
        <div>
          <h2 id="projects-title">Projects</h2>
          <p>Projects in this organization.</p>
        </div>
        <div className="project-heading-actions">
          {!search && filteredProjects.length > 4 && (
            <button
              aria-expanded={showAll || Boolean(search)}
              className="section-link"
              onClick={() => setShowAll((value) => !value)}
              type="button"
            >
              {showAll || search ? "Show fewer" : "View all"}
              <Icon name="arrow-right" width={14} height={14} />
            </button>
          )}
          {canCreate && (
            <button className="primary-button project-create-button" onClick={onCreate} type="button">
              <Icon name="plus" width={14} height={14} />
              New project
            </button>
          )}
        </div>
      </div>
      {isLoading ? (
        <LoadingState label="Loading projects" rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : visibleProjects.length > 0 ? (
        <div className="project-list">
          {visibleProjects.map((project) => {
            const progress = getProjectProgress(tasks, project.id);
            return (
            <article className="project-card" key={project.id}>
              <div className="project-card-top">
                <span className="project-symbol" aria-hidden="true">
                  {project.name
                    .split(/\s+/u)
                    .slice(0, 2)
                    .map((word) => word[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <StatusBadge tone={project.status === "ACTIVE" ? "success" : "neutral"}>
                  {project.status === "ACTIVE" ? "Active" : "Archived"}
                </StatusBadge>
              </div>
              <h3>
                <Link
                  href={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.id)}`}
                >
                  {project.name}
                </Link>
              </h3>
              <p className="project-card-meta">
                {project.description || "No description"}
              </p>
              <div className="project-card-metrics">
                <span>{project.memberCount} {project.memberCount === 1 ? "member" : "members"}</span>
                <span>{project.taskCount} {project.taskCount === 1 ? "task" : "tasks"}</span>
              </div>
              <div className="project-progress" aria-label={`${progress}% complete`}>
                <span><i style={{ width: `${progress}%` }} /></span>
                <strong>{progress}%</strong>
              </div>
              {project.canManage && project.status === "ACTIVE" && (
                <div className="project-actions">
                  <button className="text-button" onClick={() => onEdit(project)} type="button">
                    Edit
                  </button>
                  <button className="text-button project-archive-action" onClick={() => onArchive(project)} type="button">
                    Archive
                  </button>
                </div>
              )}
            </article>
            );
          })}
        </div>
      ) : projects.length === 0 && !search ? (
        <EmptyState
          icon="briefcase"
          title="No projects yet"
          message={canCreate
            ? "Create your first project to give your team a place to work."
            : "Projects you’re assigned to will appear here."}
          action={canCreate ? (
            <button className="button button-primary button-small" onClick={onCreate} type="button">
              Create a project
            </button>
          ) : undefined}
        />
      ) : (
        <EmptyState
          icon="search"
          title="No projects match your search"
          message="Try another project name or description."
        />
      )}
    </section>
  );
}

type TasksSectionProps = {
  tasks: Task[];
  projects: OrganizationProject[];
  organizationId: string;
  search: string;
  onClearSearch: () => void;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

const taskStatusLabel: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Completed",
};

const priorityLabel: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export function TasksSection({
  tasks,
  projects,
  organizationId,
  search,
  onClearSearch,
  isLoading,
  error,
  onRetry,
}: TasksSectionProps) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const visibleTasks = tasks.filter((task) => {
    const projectName = projectNames.get(task.projectId) ?? "";
    const matchesSearch = `${task.title} ${projectName} ${task.status} ${task.priority}`
      .toLowerCase()
      .includes(search.toLowerCase());
    return (
      matchesSearch &&
      (statusFilter === "ALL" || task.status === statusFilter) &&
      (priorityFilter === "ALL" || task.priority === priorityFilter)
    );
  });
  const hasFilters = Boolean(search) || statusFilter !== "ALL" || priorityFilter !== "ALL";

  function resetFilters() {
    setStatusFilter("ALL");
    setPriorityFilter("ALL");
    onClearSearch();
  }

  return (
    <section aria-labelledby="tasks-title" className="surface-card tasks-card" id="my-tasks">
      <div className="section-heading">
        <div>
          <h2 id="tasks-title">Project tasks</h2>
          <p>Active work across the projects you can access.</p>
        </div>
        <div className="task-filters" aria-label="Filter tasks">
          <label className="sr-only" htmlFor="status-filter">Filter by status</label>
          <select
            className="filter-select"
            id="status-filter"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="ALL">All statuses</option>
            <option value="TODO">To do</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="BLOCKED">Blocked</option>
            <option value="DONE">Completed</option>
          </select>
          <label className="sr-only" htmlFor="priority-filter">Filter by priority</label>
          <select
            className="filter-select"
            id="priority-filter"
            onChange={(event) => setPriorityFilter(event.target.value)}
            value={priorityFilter}
          >
            <option value="ALL">All priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>
      <div className="task-table-head" aria-hidden="true">
        <span>Task</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Due date</span>
      </div>
      <div className="task-list" aria-live="polite">
        {isLoading ? (
          <LoadingState label="Loading tasks" rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : visibleTasks.length > 0 ? (
          visibleTasks.map((task) => {
            const overdue = isOverdue(task);
            return (
              <article className="task-row" key={task.id}>
                <div className="task-title-wrap">
                  <span
                    aria-label={task.status === "DONE" ? "Completed" : "Not completed"}
                    className={`task-check${task.status === "DONE" ? " done" : ""}`}
                  >
                    {task.status === "DONE" && <Icon name="check" width={12} height={12} />}
                  </span>
                  <Link
                    className="task-title-copy task-title-link"
                    href={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}`}
                  >
                    <strong>{task.title}</strong>
                    <span>{projectNames.get(task.projectId) ?? "Project"}</span>
                  </Link>
                </div>
                <span className={`task-status ${task.status.toLowerCase().replace("_", "-")}`}>
                  {taskStatusLabel[task.status]}
                </span>
                <span className={`priority-badge ${task.priority.toLowerCase()}`}>
                  {priorityLabel[task.priority]}
                </span>
                <time
                  className={`task-due${overdue ? " overdue" : ""}`}
                  dateTime={task.dueDate ?? undefined}
                >
                  {overdue ? "Overdue" : task.dueDate ? formatDueDate(task.dueDate) : "No date"}
                </time>
              </article>
            );
          })
        ) : (
          <EmptyState
            icon="check-square"
            title={hasFilters ? "No tasks match these filters" : "Nothing on your list yet"}
            message={
              hasFilters
                ? "Clear the filters or try a different search."
                : "Create your first task from a project page."
            }
            action={hasFilters ? (
              <button className="button button-secondary button-small" onClick={resetFilters} type="button">
                Clear filters
              </button>
            ) : undefined}
          />
        )}
      </div>
    </section>
  );
}

type ActivitySectionProps = {
  activities: AuditLogItem[];
  organizationId: string;
  canView: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function ActivitySection({
  activities,
  organizationId,
  canView,
  isLoading,
  error,
  onRetry,
}: ActivitySectionProps) {
  return (
    <section aria-labelledby="activity-title" className="surface-card section-card">
      <div className="section-heading">
        <div>
          <h2 id="activity-title">Recent activity</h2>
          <p>Latest organization changes.</p>
        </div>
        {canView && (
          <Link className="section-link" href={`/organizations/${encodeURIComponent(organizationId)}/audit-logs`}>
            View all <Icon name="arrow-right" width={14} height={14} />
          </Link>
        )}
      </div>
      <div className="activity-list" aria-live="polite">
        {isLoading ? (
          <LoadingState label="Loading recent activity" rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : activities.length > 0 ? (
          activities.slice(0, 6).map((activity) => {
            const detail = getAuditActivity(activity);
            return (
            <article className="activity-item" key={activity.id}>
              <span aria-hidden="true" className="activity-avatar">
                <Icon
                  name={activity.targetType === "ORGANIZATION_MEMBER"
                    ? "users"
                    : activity.targetType === "TASK"
                      ? "check-square"
                      : "briefcase"}
                  width={17}
                  height={17}
                />
              </span>
              <div className="activity-copy">
                <p>
                  <strong>{activity.actorName}</strong> {detail.action}{" "}
                  <span>{detail.target}</span>
                </p>
                <time dateTime={activity.createdAt}>{formatRelativeTime(activity.createdAt)}</time>
              </div>
            </article>
            );
          })
        ) : (
          <EmptyState
            icon="activity"
            title={canView ? "No organization activity yet" : "Activity is role-restricted"}
            message={canView
              ? "Project, task, member, and file changes will appear here."
              : "Owners and Admins can review organization-wide audit activity."}
          />
        )}
      </div>
    </section>
  );
}

export function TaskOverviewSection({ tasks }: { tasks: Task[] }) {
  const summary = getTaskSummary(tasks);
  const completedPercentage = summary.total === 0
    ? 0
    : Math.round((summary.completed / summary.total) * 100);
  return (
    <section className="surface-card section-card task-overview-card" aria-labelledby="task-overview-title">
      <div className="section-heading">
        <div>
          <h2 id="task-overview-title">Tasks overview</h2>
          <p>Completion across accessible projects.</p>
        </div>
        <a className="section-link" href="#my-tasks">View tasks <Icon name="arrow-right" width={14} height={14} /></a>
      </div>
      {summary.total === 0 ? (
        <EmptyState icon="check-square" title="No tasks yet" message="Tasks created inside your projects will be summarized here." />
      ) : (
        <div className="task-overview-content">
          <div className="task-progress-ring" style={{ background: `conic-gradient(var(--brand-500) ${completedPercentage}%, var(--neutral-100) 0)` }}>
            <span><strong>{summary.total}</strong>Total</span>
          </div>
          <dl className="task-overview-legend">
            <div><dt><i className="legend-dot completed" />Completed</dt><dd>{summary.completed}</dd></div>
            <div><dt><i className="legend-dot progress" />In progress</dt><dd>{summary.inProgress}</dd></div>
            <div><dt><i className="legend-dot blocked" />Blocked</dt><dd>{summary.blocked}</dd></div>
            <div><dt><i className="legend-dot overdue" />Overdue</dt><dd>{summary.overdue}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

export function QuickActionsSection({
  organizationId,
  canCreateProject,
  canViewAudit,
  onCreateProject,
  onNotifications,
}: {
  organizationId: string;
  canCreateProject: boolean;
  canViewAudit: boolean;
  onCreateProject: () => void;
  onNotifications: () => void;
}) {
  const peoplePath = `/organizations/${encodeURIComponent(organizationId)}/members`;
  const auditPath = `/organizations/${encodeURIComponent(organizationId)}/audit-logs`;
  return (
    <section className="surface-card section-card quick-actions-card" aria-labelledby="quick-actions-title">
      <div className="section-heading">
        <div><h2 id="quick-actions-title">Quick actions</h2><p>Jump straight into common work.</p></div>
      </div>
      <div className="quick-actions-grid">
        {canCreateProject ? (
          <button onClick={onCreateProject} type="button"><span><Icon name="plus" width={20} height={20} /></span>Create project</button>
        ) : (
          <a href="#projects"><span><Icon name="briefcase" width={20} height={20} /></span>View projects</a>
        )}
        <a href="#my-tasks"><span><Icon name="check-square" width={20} height={20} /></span>Review work</a>
        <Link href={peoplePath}><span><Icon name="users" width={20} height={20} /></span>Manage people</Link>
        {canViewAudit ? (
          <Link href={auditPath}><span><Icon name="activity" width={20} height={20} /></span>Audit logs</Link>
        ) : (
          <button onClick={onNotifications} type="button"><span><Icon name="bell" width={20} height={20} /></span>Notifications</button>
        )}
      </div>
    </section>
  );
}
