export type AnalyticsStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type AnalyticsDays = 7 | 30 | 90;

export type AnalyticsWorkload = {
  userId: string | null;
  name: string;
  total: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
};

export type OrganizationAnalytics = {
  projects: { total: number; active: number };
  tasks: { total: number; completed: number; inProgress: number; overdue: number; blocked: number };
  projectOptions: { id: string; name: string; status: "ACTIVE" | "ARCHIVED" }[];
  projectCompletion: {
    id: string;
    name: string;
    totalTasks: number;
    completedTasks: number;
    completionPercentage: number;
  }[];
  recentActivity: {
    id: string;
    eventType: string;
    message: string;
    actorName: string;
    taskTitle: string;
    projectName: string;
    createdAt: string;
  }[];
  workload: AnalyticsWorkload[];
};

export type ProjectAnalytics = {
  project: { id: string; name: string; status: "ACTIVE" | "ARCHIVED" };
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
  recentlyCompleted: { id: string; title: string; completedAt: string }[];
  overdueWork: {
    id: string;
    title: string;
    status: AnalyticsStatus;
    dueAt: string;
    assigneeName: string | null;
  }[];
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWorkload(value: unknown): value is AnalyticsWorkload {
  return isRecord(value) &&
    (value.userId === null || typeof value.userId === "string") &&
    typeof value.name === "string" &&
    [value.total, value.todo, value.inProgress, value.blocked, value.done].every(isNumber);
}

function isOrganizationAnalytics(value: unknown): value is OrganizationAnalytics {
  if (!isRecord(value) || !isRecord(value.projects) || !isRecord(value.tasks)) return false;
  return [value.projects.total, value.projects.active].every(isNumber) &&
    [value.tasks.total, value.tasks.completed, value.tasks.inProgress, value.tasks.overdue, value.tasks.blocked].every(isNumber) &&
    Array.isArray(value.projectOptions) && value.projectOptions.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.name === "string" &&
      (item.status === "ACTIVE" || item.status === "ARCHIVED")) &&
    Array.isArray(value.projectCompletion) && value.projectCompletion.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.name === "string" &&
      [item.totalTasks, item.completedTasks, item.completionPercentage].every(isNumber)) &&
    Array.isArray(value.recentActivity) && value.recentActivity.every((item) =>
      isRecord(item) && [item.id, item.eventType, item.message, item.actorName, item.taskTitle, item.projectName, item.createdAt].every((field) => typeof field === "string")) &&
    Array.isArray(value.workload) && value.workload.every(isWorkload);
}

function isProjectAnalytics(value: unknown): value is ProjectAnalytics {
  if (!isRecord(value) || !isRecord(value.project) || !isRecord(value.tasks) || !isRecord(value.blockers)) return false;
  return typeof value.project.id === "string" && typeof value.project.name === "string" &&
    (value.project.status === "ACTIVE" || value.project.status === "ARCHIVED") &&
    [value.tasks.total, value.tasks.completed, value.tasks.inProgress, value.tasks.overdue, value.tasks.blocked, value.tasks.completionPercentage].every(isNumber) &&
    [value.blockers.total, value.blockers.unresolved, value.blockers.resolved].every(isNumber) &&
    Array.isArray(value.activityByDay) && value.activityByDay.every((item) =>
      isRecord(item) && typeof item.date === "string" && isNumber(item.count)) &&
    Array.isArray(value.workload) && value.workload.every(isWorkload) &&
    Array.isArray(value.recentlyCompleted) && value.recentlyCompleted.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.completedAt === "string") &&
    Array.isArray(value.overdueWork) && value.overdueWork.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.title === "string" &&
      typeof item.dueAt === "string" && (item.assigneeName === null || typeof item.assigneeName === "string"));
}

async function readResponse<T>(
  response: Response,
  isExpected: (value: unknown) => value is T,
): Promise<T> {
  if (response.status === 401) throw new Error("Your session has expired. Sign in again to continue.");
  if (response.status === 403) throw new Error("You don’t have permission to view this analytics report.");
  if (response.status === 404) throw new Error("This organization or project is no longer available.");
  if (!response.ok) throw new Error("We couldn’t load analytics. Please try again.");
  const result: unknown = await response.json();
  if (!isExpected(result)) throw new Error("The server returned an unexpected analytics response.");
  return result;
}

function buildQuery(filters: { days: AnalyticsDays; projectId?: string; status?: AnalyticsStatus }): string {
  const query = new URLSearchParams({ days: String(filters.days) });
  if (filters.projectId) query.set("projectId", filters.projectId);
  if (filters.status) query.set("status", filters.status);
  return query.toString();
}

export async function getOrganizationAnalytics(
  token: string,
  organizationId: string,
  filters: { days: AnalyticsDays; projectId?: string },
): Promise<OrganizationAnalytics> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/analytics?${buildQuery(filters)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return readResponse(response, isOrganizationAnalytics);
}

export async function getProjectAnalytics(
  token: string,
  organizationId: string,
  projectId: string,
  filters: { days: AnalyticsDays; status?: AnalyticsStatus },
): Promise<ProjectAnalytics> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/analytics?${buildQuery(filters)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return readResponse(response, isProjectAnalytics);
}