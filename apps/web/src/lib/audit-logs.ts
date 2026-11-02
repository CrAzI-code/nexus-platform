export type AuditLogAction =
  | "ORGANIZATION_MEMBER_ROLE_CHANGED"
  | "ORGANIZATION_MEMBER_REMOVED"
  | "INVITATION_CREATED"
  | "INVITATION_REVOKED"
  | "INVITATION_ACCEPTED"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_ARCHIVED"
  | "PROJECT_RESTORED"
  | "PROJECT_MEMBER_ADDED"
  | "PROJECT_MEMBER_REMOVED"
  | "TASK_ASSIGNED"
  | "TASK_UPDATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ARCHIVED"
  | "TASK_RESTORED";

export type AuditLogTargetType =
  | "ORGANIZATION_MEMBER"
  | "INVITATION"
  | "PROJECT"
  | "PROJECT_MEMBER"
  | "TASK";

export type AuditLogItem = {
  id: string;
  organizationId: string;
  actorId: string;
  actorName: string;
  action: AuditLogAction;
  targetType: AuditLogTargetType;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type AuditLogPage = {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type AuditLogFilters = {
  action?: AuditLogAction;
  actorId?: string;
  targetType?: AuditLogTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const auditActions: AuditLogAction[] = [
  "ORGANIZATION_MEMBER_ROLE_CHANGED",
  "ORGANIZATION_MEMBER_REMOVED",
  "INVITATION_CREATED",
  "INVITATION_REVOKED",
  "INVITATION_ACCEPTED",
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_ARCHIVED",
  "PROJECT_RESTORED",
  "PROJECT_MEMBER_ADDED",
  "PROJECT_MEMBER_REMOVED",
  "TASK_ASSIGNED",
  "TASK_UPDATED",
  "TASK_STATUS_CHANGED",
  "TASK_ARCHIVED",
  "TASK_RESTORED",
];
const targetTypes: AuditLogTargetType[] = [
  "ORGANIZATION_MEMBER",
  "INVITATION",
  "PROJECT",
  "PROJECT_MEMBER",
  "TASK",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuditLogItem(value: unknown): value is AuditLogItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    typeof value.actorId === "string" &&
    typeof value.actorName === "string" &&
    typeof value.action === "string" &&
    auditActions.includes(value.action as AuditLogAction) &&
    typeof value.targetType === "string" &&
    targetTypes.includes(value.targetType as AuditLogTargetType) &&
    typeof value.targetId === "string" &&
    (value.before === null || isRecord(value.before) || Array.isArray(value.before)) &&
    (value.after === null || isRecord(value.after) || Array.isArray(value.after)) &&
    typeof value.createdAt === "string"
  );
}

export async function listOrganizationAuditLogs(
  token: string,
  organizationId: string,
  filters: AuditLogFilters,
): Promise<AuditLogPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.action) query.set("action", filters.action);
  if (filters.actorId) query.set("actorId", filters.actorId);
  if (filters.targetType) query.set("targetType", filters.targetType);
  if (filters.targetId) query.set("targetId", filters.targetId);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/audit-logs?${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
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
      throw new Error("Only organization Owners and Admins can view audit logs.");
    }
    if (response.status === 404) {
      throw new Error("This organization is no longer available.");
    }
    if (response.status === 400) {
      throw new Error("Check the audit-log filters and try again.");
    }
    throw new Error("We couldn’t load audit logs. Please try again.");
  }

  const result: unknown = await response.json();
  if (
    !isRecord(result) ||
    !Array.isArray(result.items) ||
    !result.items.every(isAuditLogItem) ||
    result.page !== filters.page ||
    result.pageSize !== filters.pageSize ||
    typeof result.hasMore !== "boolean"
  ) {
    throw new Error("The server returned an unexpected audit-log response.");
  }
  return {
    items: result.items,
    page: filters.page,
    pageSize: filters.pageSize,
    hasMore: result.hasMore,
  };
}
