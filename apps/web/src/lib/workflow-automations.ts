export type WorkflowTrigger =
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "TASK_DUE_DATE_APPROACHING"
  | "TASK_OVERDUE"
  | "TASK_BLOCKER_REPORTED"
  | "TASK_BLOCKER_RESOLVED";

export type WorkflowAction =
  | "SEND_NOTIFICATION"
  | "CHANGE_STATUS"
  | "ASSIGN_MEMBER";

export type WorkflowAutomation = {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  conditionPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null;
  conditionStatus: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | null;
  conditionAssigneeId: string | null;
  action: WorkflowAction;
  actionValue: string | null;
  actionAssigneeId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  executions: WorkflowExecution[];
};

export type WorkflowExecution = {
  id: string;
  taskId: string;
  taskTitle: string;
  trigger: WorkflowTrigger;
  status: "RUNNING" | "SUCCEEDED" | "SKIPPED" | "FAILED";
  reason: string | null;
  error: string | null;
  attempt: number;
  triggeredAt: string;
  completedAt: string | null;
};

export type WorkflowAutomationInput = {
  name: string;
  trigger: WorkflowTrigger;
  conditionPriority: WorkflowAutomation["conditionPriority"];
  conditionStatus: WorkflowAutomation["conditionStatus"];
  conditionAssigneeId: string | null;
  action: WorkflowAction;
  actionValue: string | null;
  actionAssigneeId: string | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrigger(value: unknown): value is WorkflowTrigger {
  return (
    value === "TASK_CREATED" ||
    value === "TASK_STATUS_CHANGED" ||
    value === "TASK_ASSIGNED" ||
    value === "TASK_DUE_DATE_APPROACHING" ||
    value === "TASK_OVERDUE" ||
    value === "TASK_BLOCKER_REPORTED" ||
    value === "TASK_BLOCKER_RESOLVED"
  );
}

function isExecution(value: unknown): value is WorkflowExecution {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    typeof value.taskTitle === "string" &&
    isTrigger(value.trigger) &&
    (value.status === "RUNNING" ||
      value.status === "SUCCEEDED" ||
      value.status === "SKIPPED" ||
      value.status === "FAILED") &&
    (typeof value.reason === "string" || value.reason === null) &&
    (typeof value.error === "string" || value.error === null) &&
    typeof value.attempt === "number" &&
    typeof value.triggeredAt === "string" &&
    (typeof value.completedAt === "string" || value.completedAt === null)
  );
}

function isAutomation(value: unknown): value is WorkflowAutomation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isTrigger(value.trigger) &&
    (value.conditionPriority === "LOW" ||
      value.conditionPriority === "MEDIUM" ||
      value.conditionPriority === "HIGH" ||
      value.conditionPriority === "URGENT" ||
      value.conditionPriority === null) &&
    (value.conditionStatus === "TODO" ||
      value.conditionStatus === "IN_PROGRESS" ||
      value.conditionStatus === "BLOCKED" ||
      value.conditionStatus === "DONE" ||
      value.conditionStatus === null) &&
    (typeof value.conditionAssigneeId === "string" ||
      value.conditionAssigneeId === null) &&
    (value.action === "SEND_NOTIFICATION" ||
      value.action === "CHANGE_STATUS" ||
      value.action === "ASSIGN_MEMBER") &&
    (typeof value.actionValue === "string" || value.actionValue === null) &&
    (typeof value.actionAssigneeId === "string" ||
      value.actionAssigneeId === null) &&
    typeof value.enabled === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.executions) &&
    value.executions.every(isExecution)
  );
}

async function request(
  token: string,
  organizationId: string,
  projectId: string,
  path = "",
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/automations${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("NEXUS couldn’t reach the API. Check your connection.");
    }
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session has expired. Sign in again.");
    }
    if (response.status === 403) {
      throw new Error("Only project managers can manage automations.");
    }
    if (response.status === 404) {
      throw new Error("This project or automation is no longer available.");
    }
    if (response.status === 400) {
      const body: unknown = await response.json().catch(() => null);
      if (isRecord(body) && typeof body.message === "string") {
        throw new Error(body.message);
      }
      throw new Error("Check the automation details and try again.");
    }
    throw new Error("We couldn’t update automations. Please try again.");
  }
  return response.json();
}

async function readAutomation(
  response: Promise<unknown>,
): Promise<WorkflowAutomation> {
  const result = await response;
  if (!isAutomation(result)) {
    throw new Error("The server returned an unexpected automation.");
  }
  return result;
}

export async function listWorkflowAutomations(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<WorkflowAutomation[]> {
  const result = await request(token, organizationId, projectId);
  if (!Array.isArray(result) || !result.every(isAutomation)) {
    throw new Error("The server returned an unexpected automation list.");
  }
  return result;
}

export async function createWorkflowAutomation(
  token: string,
  organizationId: string,
  projectId: string,
  input: WorkflowAutomationInput,
): Promise<WorkflowAutomation> {
  return readAutomation(
    request(token, organizationId, projectId, "", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function updateWorkflowAutomation(
  token: string,
  organizationId: string,
  projectId: string,
  automationId: string,
  input: WorkflowAutomationInput,
): Promise<WorkflowAutomation> {
  return readAutomation(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(automationId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  );
}

export async function setWorkflowAutomationEnabled(
  token: string,
  organizationId: string,
  projectId: string,
  automationId: string,
  enabled: boolean,
): Promise<WorkflowAutomation> {
  return readAutomation(
    request(
      token,
      organizationId,
      projectId,
      `/${encodeURIComponent(automationId)}/enabled`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
  );
}

export async function deleteWorkflowAutomation(
  token: string,
  organizationId: string,
  projectId: string,
  automationId: string,
): Promise<void> {
  await request(
    token,
    organizationId,
    projectId,
    `/${encodeURIComponent(automationId)}`,
    { method: "DELETE" },
  );
}
