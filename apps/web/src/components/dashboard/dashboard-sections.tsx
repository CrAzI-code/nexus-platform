"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  Activity,
  TaskProject,
  Task,
  TaskPriority,
  TaskStatus,
} from "./dashboard-data";
import { formatDueDate, isOverdue } from "./dashboard-data";
import { Icon } from "./icons";
import type { OrganizationProject } from "@/lib/organizations";

type OverviewSectionProps = {
  tasks: Task[];
};

export function OverviewSection({ tasks }: OverviewSectionProps) {
  const completed = tasks.filter((task) => task.status === "DONE").length;
  const inProgress = tasks.filter((task) => task.status === "IN_PROGRESS").length;
  const overdue = tasks.filter(isOverdue).length;
  const cards = [
    {
      label: "Tasks assigned to me",
      value: tasks.length,
      note: "Across your active projects",
      icon: "check-square" as const,
      tone: "",
    },
    {
      label: "In progress",
      value: inProgress,
      note: "Moving forward this week",
      icon: "activity" as const,
      tone: "",
    },
    {
      label: "Completed",
      value: completed,
      note: "Finished in this workspace",
      icon: "check" as const,
      tone: "green",
    },
    {
      label: "Overdue",
      value: overdue,
      note: overdue === 0 ? "You are all caught up" : "Needs your attention",
      icon: "clock" as const,
      tone: overdue > 0 ? "red" : "amber",
    },
  ];

  return (
    <section aria-labelledby="overview-title" className="overview-section">
      <div className="section-heading">
        <div>
          <h2 id="overview-title">Your overview</h2>
          <p>A quick look at what needs your attention.</p>
        </div>
      </div>
      <div className="overview-grid">
        {cards.map((card) => (
          <article className="stat-card" key={card.label}>
            <div className="stat-topline">
              <span>{card.label}</span>
              <span className={`stat-icon ${card.tone}`}>
                <Icon name={card.icon} width={16} height={16} />
              </span>
            </div>
            <div className="stat-value">
              <strong>{card.value}</strong>
              <span>tasks</span>
            </div>
            <p className="stat-footnote">{card.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

type ProjectsSectionProps = {
  organizationId: string;
  projects: OrganizationProject[];
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
    search || showAll ? filteredProjects : filteredProjects.slice(0, 2);

  return (
    <section aria-labelledby="projects-title" className="surface-card section-card" id="projects">
      <div className="section-heading">
        <div>
          <h2 id="projects-title">Projects</h2>
          <p>Projects in this organization.</p>
        </div>
        <div className="project-heading-actions">
          {!search && filteredProjects.length > 2 && (
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
        <p className="project-state" aria-live="polite">Loading projects…</p>
      ) : error ? (
        <div className="project-state project-state-error" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={onRetry} type="button">Try again</button>
        </div>
      ) : visibleProjects.length > 0 ? (
        <div className="project-list">
          {visibleProjects.map((project) => (
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
                <span className={`project-status ${project.status.toLowerCase()}`}>
                  {project.status === "ACTIVE" ? "Active" : "Archived"}
                </span>
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
          ))}
        </div>
      ) : projects.length === 0 && !search ? (
        <EmptyState
          title="No projects yet"
          message={canCreate
            ? "Create your first project to give your team a place to work."
            : "Projects you’re assigned to will appear here."}
          actionLabel={canCreate ? "Create a project" : undefined}
          onAction={canCreate ? onCreate : undefined}
        />
      ) : (
        <EmptyState
          title="No projects match your search"
          message="Try another project name or description."
        />
      )}
    </section>
  );
}

type TasksSectionProps = {
  tasks: Task[];
  projects: TaskProject[];
  search: string;
  onClearSearch: () => void;
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
  search,
  onClearSearch,
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
          <h2 id="tasks-title">My tasks</h2>
          <p>Priorities to keep your week moving.</p>
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
        {visibleTasks.length > 0 ? (
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
                  <span className="task-title-copy">
                    <strong>{task.title}</strong>
                    <span>{projectNames.get(task.projectId) ?? "Project"}</span>
                  </span>
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
            title={hasFilters ? "No tasks match these filters" : "Nothing on your list yet"}
            message={
              hasFilters
                ? "Clear the filters or try a different search."
                : "Project task management will be available in a later milestone."
            }
            actionLabel={hasFilters ? "Clear filters" : undefined}
            onAction={hasFilters ? resetFilters : undefined}
          />
        )}
      </div>
    </section>
  );
}

type ActivitySectionProps = {
  activities: Activity[];
  search: string;
};

export function ActivitySection({ activities, search }: ActivitySectionProps) {
  const visibleActivities = activities.filter((activity) =>
    `${activity.person} ${activity.action} ${activity.target} ${activity.project}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <section aria-labelledby="activity-title" className="surface-card section-card">
      <div className="section-heading">
        <div>
          <h2 id="activity-title">Recent activity</h2>
          <p>A little context from your team.</p>
        </div>
      </div>
      <div className="activity-list" aria-live="polite">
        {visibleActivities.length > 0 ? (
          visibleActivities.slice(0, 5).map((activity) => (
            <article className="activity-item" key={activity.id}>
              <span
                aria-hidden="true"
                className="activity-avatar"
                style={{ backgroundColor: activity.color }}
              >
                {activity.initials}
              </span>
              <div className="activity-copy">
                <p>
                  <strong>{activity.person}</strong> {activity.action}{" "}
                  <strong>{activity.target}</strong>
                </p>
                <span>{activity.time}</span>
                <span className="activity-label">{activity.project}</span>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            title="No activity matches your search"
            message="Try a different name, task, or project."
          />
        )}
      </div>
    </section>
  );
}

function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction && (
        <button className="text-button" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
