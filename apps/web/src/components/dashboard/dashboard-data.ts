import type { TaskPriority, TaskStatus } from "@/lib/tasks";
import type { AuditLogAction, AuditLogItem } from "@/lib/audit-logs";
import type { OrganizationMembership } from "@/lib/organizations";

export type { TaskPriority, TaskStatus } from "@/lib/tasks";

export type Workspace = {
  id: string;
  name: string;
  plan: string;
  initials: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
};

export function getWorkspaceInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return initials || "NX";
}

export function toWorkspace(organization: OrganizationMembership): Workspace {
  return {
    id: organization.id,
    name: organization.name,
    plan: `${organization.role.toLowerCase()} workspace`,
    initials: getWorkspaceInitials(organization.name),
    role: organization.role,
  };
}

export type TaskProject = { id: string; name: string };

export type Task = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  archivedAt: string | null;
};

export type TaskSummary = {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  overdue: number;
};

export function getTaskSummary(tasks: Task[]): TaskSummary {
  return tasks.reduce<TaskSummary>(
    (summary, task) => ({
      total: summary.total + 1,
      completed: summary.completed + (task.status === "DONE" ? 1 : 0),
      inProgress: summary.inProgress + (task.status === "IN_PROGRESS" ? 1 : 0),
      blocked: summary.blocked + (task.status === "BLOCKED" ? 1 : 0),
      overdue: summary.overdue + (isOverdue(task) ? 1 : 0),
    }),
    { total: 0, completed: 0, inProgress: 0, blocked: 0, overdue: 0 },
  );
}

export function getProjectProgress(tasks: Task[], projectId: string): number {
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  if (projectTasks.length === 0) return 0;
  const completed = projectTasks.filter((task) => task.status === "DONE").length;
  return Math.round((completed / projectTasks.length) * 100);
}

const activityLabels: Record<AuditLogAction, string> = {
  ORGANIZATION_MEMBER_ROLE_CHANGED: "updated a member role",
  ORGANIZATION_MEMBER_REMOVED: "removed a member",
  INVITATION_CREATED: "invited a teammate",
  INVITATION_REVOKED: "revoked an invitation",
  INVITATION_ACCEPTED: "accepted an invitation",
  INVITATION_RESENT: "resent an invitation",
  INVITATION_DECLINED: "declined an invitation",
  PROJECT_CREATED: "created a project",
  PROJECT_UPDATED: "updated a project",
  PROJECT_ARCHIVED: "archived a project",
  PROJECT_RESTORED: "restored a project",
  PROJECT_MEMBER_ADDED: "added a project member",
  PROJECT_MEMBER_REMOVED: "removed a project member",
  TASK_ASSIGNED: "assigned a task",
  TASK_UPDATED: "updated a task",
  TASK_STATUS_CHANGED: "changed a task status",
  TASK_BLOCKED: "blocked a task",
  TASK_UNBLOCKED: "resolved a task blocker",
  TASK_ARCHIVED: "archived a task",
  TASK_RESTORED: "restored a task",
  FILE_UPLOADED: "uploaded a file",
  FILE_REMOVED: "removed a file",
};

function extractTargetName(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidates = [record.name, record.title, record.fileName, record.email];
  return candidates.find((candidate): candidate is string =>
    typeof candidate === "string" && candidate.trim().length > 0,
  ) ?? null;
}

export function getAuditActivity(log: AuditLogItem): {
  action: string;
  target: string;
} {
  const targetName = extractTargetName(log.after) ?? extractTargetName(log.before);
  return {
    action: activityLabels[log.action],
    target: targetName ?? log.targetType.toLowerCase().replaceAll("_", " "),
  };
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown time";
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: new Date(value).getUTCFullYear() === new Date(now).getUTCFullYear()
      ? undefined
      : "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDueDate(value: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowValue = tomorrow.toISOString().slice(0, 10);

  if (value === today) return "Today";
  if (value === tomorrowValue) return "Tomorrow";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function isOverdue(task: Task): boolean {
  if (task.status === "DONE" || !task.dueDate || task.archivedAt) return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}
