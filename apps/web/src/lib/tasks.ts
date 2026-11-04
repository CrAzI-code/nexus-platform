export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type ProjectTask = {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: "ACTIVE" | "ARCHIVED";
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  commentCount: number;
  canManage: boolean;
  canAssignOthers: boolean;
  activeBlocker: TaskBlockerSummary | null;
};

export type TaskBlockerSummary = {
  id: string;
  reason: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
};

export type TaskBlockerHistory = TaskBlockerSummary & {
  resolvedById: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
};

export type TaskComment = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type TaskActivity = {
  id: string;
  actorId: string;
  actorName: string;
  type:
    | "CREATED"
    | "UPDATED"
    | "STATUS_CHANGED"
    | "ASSIGNEE_CHANGED"
    | "COMMENT_ADDED"
    | "BLOCKER_CREATED"
    | "BLOCKER_RESOLVED"
    | "ARCHIVED"
    | "RESTORED";
  message: string;
  createdAt: string;
};

const activityTypes: readonly TaskActivity["type"][] = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "COMMENT_ADDED",
  "BLOCKER_CREATED",
  "BLOCKER_RESOLVED",
  "ARCHIVED",
  "RESTORED",
];

export type TaskDetails = ProjectTask & {
  canParticipate: boolean;
  comments: TaskComment[];
  activity: TaskActivity[];
  blockerHistory: TaskBlockerHistory[];
};

export type TaskProjectMember = {
  id: string;
  name: string;
  isCurrentUser: boolean;
};

export type TaskMembers = {
  members: TaskProjectMember[];
  canAssignOthers: boolean;
};

export type TaskInput = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAt: string | null;
};

export type TaskUpdateInput = Partial<TaskInput>;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class TaskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "TaskApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value
      .map(readErrorMessage)
      .filter((message): message is string => message !== null);
    return messages.length > 0 ? messages.join(" ") : null;
  }
  if (!isRecord(value)) return null;

  for (const key of ["message", "detail", "title", "longMessage", "error"]) {
    const message = readErrorMessage(value[key]);
    if (message) return message;
  }
  if (Array.isArray(value.errors)) {
    return readErrorMessage(value.errors);
  }
  return null;
}

export function getTaskErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof TaskApiError) return error.message;
  if (error instanceof Error) {
    const message =
      typeof error.message === "string" ? error.message.trim() : "";
    if (message && message !== "[object Object]") return message;
    const causeMessage = readErrorMessage(error.cause);
    return causeMessage && causeMessage !== "[object Object]"
      ? causeMessage
      : fallback;
  }
  const message = readErrorMessage(error);
  return message && message !== "[object Object]" ? message : fallback;
}

function isNamedUser(
  value: unknown,
): value is { id: string; name: string } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

function isTaskBlockerSummary(value: unknown): value is TaskBlockerSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.reason === "string" &&
    typeof value.createdById === "string" &&
    typeof value.createdByName === "string" &&
    typeof value.createdAt === "string"
  );
}

function isTaskBlockerHistory(value: unknown): value is TaskBlockerHistory {
  const resolvedById = isRecord(value) ? value.resolvedById : undefined;
  const resolvedByName = isRecord(value) ? value.resolvedByName : undefined;
  const resolvedAt = isRecord(value) ? value.resolvedAt : undefined;
  return (
    isTaskBlockerSummary(value) &&
    (typeof resolvedById === "string" || resolvedById === null) &&
    (typeof resolvedByName === "string" || resolvedByName === null) &&
    (typeof resolvedAt === "string" || resolvedAt === null)
  );
}

function isProjectTask(value: unknown): value is ProjectTask {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.projectName === "string" &&
    (value.projectStatus === "ACTIVE" || value.projectStatus === "ARCHIVED") &&
    typeof value.title === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    (value.status === "TODO" ||
      value.status === "IN_PROGRESS" ||
      value.status === "BLOCKED" ||
      value.status === "DONE") &&
    (value.priority === "LOW" ||
      value.priority === "MEDIUM" ||
      value.priority === "HIGH" ||
      value.priority === "URGENT") &&
    (typeof value.dueAt === "string" || value.dueAt === null) &&
    (typeof value.archivedAt === "string" || value.archivedAt === null) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isNamedUser(value.creator) &&
    (value.assignee === null || isNamedUser(value.assignee)) &&
    typeof value.commentCount === "number" &&
    typeof value.canManage === "boolean" &&
    typeof value.canAssignOthers === "boolean" &&
    (value.activeBlocker === null || isTaskBlockerSummary(value.activeBlocker))
  );
}

function isTaskComment(value: unknown): value is TaskComment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.authorId === "string" &&
    typeof value.authorName === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string"
  );
}

function isTaskActivity(value: unknown): value is TaskActivity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.actorId === "string" &&
    typeof value.actorName === "string" &&
    typeof value.type === "string" &&
    activityTypes.some((type) => type === value.type) &&
    typeof value.message === "string" &&
    typeof value.createdAt === "string"
  );
}

function isTaskDetails(value: unknown): value is TaskDetails {
  if (!isRecord(value)) return false;
  const canParticipate = value.canParticipate;
  const comments = value.comments;
  const activity = value.activity;
  const blockerHistory = value.blockerHistory;
  if (!isProjectTask(value)) return false;
  return (
    typeof canParticipate === "boolean" &&
    Array.isArray(comments) &&
    comments.every(isTaskComment) &&
    Array.isArray(activity) &&
    activity.every(isTaskActivity) &&
    Array.isArray(blockerHistory) &&
    blockerHistory.every(isTaskBlockerHistory)
  );
}

function isTaskProjectMember(value: unknown): value is TaskProjectMember {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.isCurrentUser === "boolean"
  );
}

function isTaskMembers(value: unknown): value is TaskMembers {
  return (
    isRecord(value) &&
    Array.isArray(value.members) &&
    value.members.every(isTaskProjectMember) &&
    typeof value.canAssignOthers === "boolean"
  );
}

function getErrorMessage(status: number): string {
  if (status === 400) return "Check the task information and try again.";
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don’t have permission to change this task.";
  if (status === 404) return "This project or task is no longer available.";
  if (status === 409) return "This task can’t be changed in its current state.";
  return "We couldn’t complete that request. Please try again.";
}

async function request(
  token: string,
  organizationId: string,
  projectId: string,
  path = "",
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/tasks${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    },
  );
  if (!response.ok) {
    const responseText = await response.text();
    let responseBody: unknown;
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    const responseMessage = readErrorMessage(responseBody);
    throw new TaskApiError(
      responseMessage && responseMessage !== "[object Object]"
        ? responseMessage
        : getErrorMessage(response.status),
      response.status,
      responseBody,
    );
  }
  return response.json();
}

async function readTaskResponse(
  response: Promise<unknown>,
  details: true,
): Promise<TaskDetails>;
async function readTaskResponse(
  response: Promise<unknown>,
  details?: false,
): Promise<ProjectTask>;
async function readTaskResponse(
  response: Promise<unknown>,
  details = false,
): Promise<ProjectTask | TaskDetails> {
  const result = await response;
  if (details && isTaskDetails(result)) return result;
  if (!details && isProjectTask(result)) return result;
  throw new Error("The server returned an unexpected task response.");
}

export async function listProjectTasks(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<ProjectTask[]> {
  const result = await request(token, organizationId, projectId);
  if (!Array.isArray(result) || !result.every(isProjectTask)) {
    throw new Error("The server returned an unexpected task list.");
  }
  return result;
}

export async function listTaskProjectMembers(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<TaskMembers> {
  const result = await request(
    token,
    organizationId,
    projectId,
    "/members",
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!isTaskMembers(result)) {
    throw new Error("The server returned an unexpected project member list.");
  }
  return result;
}

export async function getProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}`,
    ),
    true,
  );
}

export async function createProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  input: TaskInput,
): Promise<ProjectTask> {
  return readTaskResponse(
    request(token, organizationId, projectId, "", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function updateProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  input: TaskUpdateInput,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
    true,
  );
}

export async function assignProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  assigneeId: string | null,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/assignee`,
      { method: "PATCH", body: JSON.stringify({ assigneeId }) },
    ),
    true,
  );
}

export async function changeProjectTaskStatus(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  status: TaskStatus,
  blockerReason?: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(blockerReason ? { blockerReason } : {}),
        }),
      },
    ),
    true,
  );
}

export async function createProjectTaskBlocker(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  reason: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/blockers`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
    true,
  );
}

export async function resolveProjectTaskBlocker(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  blockerId: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/blockers/${encodeURIComponent(blockerId)}/resolve`,
      { method: "PATCH" },
    ),
    true,
  );
}

export async function addProjectTaskComment(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  body: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    ),
    true,
  );
}

export async function archiveProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/archive`,
      { method: "PATCH" },
    ),
    true,
  );
}

export async function restoreProjectTask(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
): Promise<TaskDetails> {
  return readTaskResponse(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(taskId)}/restore`,
      { method: "PATCH" },
    ),
    true,
  );
}
