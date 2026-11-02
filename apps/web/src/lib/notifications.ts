export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_COMMENT"
  | "TASK_MENTION"
  | "TASK_STATUS_CHANGED"
  | "PROJECT_ADDED"
  | "PROJECT_UPDATED"
  | "ORGANIZATION_INVITATION"
  | "TEAM_UPDATED";

export type NotificationResourceType =
  | "TASK"
  | "PROJECT"
  | "ORGANIZATION_INVITATION"
  | "ORGANIZATION";

export type NexusNotification = {
  id: string;
  organizationId: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: NotificationResourceType;
  resourceId: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NexusNotification[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type NotificationStreamHandler = (notification: NexusNotification) => void;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotificationType(value: unknown): value is NotificationType {
  return (
    value === "TASK_ASSIGNED" ||
    value === "TASK_COMMENT" ||
    value === "TASK_MENTION" ||
    value === "TASK_STATUS_CHANGED" ||
    value === "PROJECT_ADDED" ||
    value === "PROJECT_UPDATED" ||
    value === "ORGANIZATION_INVITATION" ||
    value === "TEAM_UPDATED"
  );
}

function isResourceType(value: unknown): value is NotificationResourceType {
  return (
    value === "TASK" ||
    value === "PROJECT" ||
    value === "ORGANIZATION_INVITATION" ||
    value === "ORGANIZATION"
  );
}

function isNotification(value: unknown): value is NexusNotification {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.organizationId === "string" &&
    (typeof value.projectId === "string" || value.projectId === null) &&
    isNotificationType(value.type) &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    isResourceType(value.resourceType) &&
    typeof value.resourceId === "string" &&
    (typeof value.readAt === "string" || value.readAt === null) &&
    typeof value.createdAt === "string"
  );
}

async function request(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
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
    if (response.status === 403 || response.status === 404) {
      throw new Error("This notification is no longer available.");
    }
    throw new Error("We couldn’t update your notifications. Please try again.");
  }
  return response.json();
}

export async function consumeNotificationStream(
  token: string,
  signal: AbortSignal,
  onNotification: NotificationStreamHandler,
  onConnected: () => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/notifications/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof TypeError) {
      throw new Error("NEXUS couldn’t reach the API. Check your connection.");
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session has expired. Sign in again.");
    }
    throw new Error("The live notification connection is unavailable.");
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("The live notification connection is unavailable.");
  }
  if (!response.body) {
    throw new Error("The live notification connection is unavailable.");
  }

  onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (eventType === "notification" && dataLines.length > 0) {
      const payload: unknown = JSON.parse(dataLines.join("\n"));
      if (!isNotification(payload)) {
        throw new Error("The server sent an invalid notification event.");
      }
      onNotification(payload);
    }
    eventType = "";
    dataLines = [];
  };

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          dispatch();
        } else if (line.startsWith("event:")) {
          eventType = line.slice(6).trimStart();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } finally {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export async function listNotifications(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<NotificationPage> {
  const result = await request(
    token,
    `/notifications?page=${page}&pageSize=${pageSize}`,
  );
  if (
    !isRecord(result) ||
    !Array.isArray(result.items) ||
    !result.items.every(isNotification) ||
    result.page !== page ||
    result.pageSize !== pageSize ||
    typeof result.hasMore !== "boolean"
  ) {
    throw new Error("The server returned an unexpected notifications response.");
  }
  return {
    items: result.items,
    page,
    pageSize,
    hasMore: result.hasMore,
  };
}

export async function getUnreadNotificationCount(
  token: string,
): Promise<number> {
  const result = await request(token, "/notifications/unread-count");
  if (!isRecord(result) || typeof result.count !== "number") {
    throw new Error("The server returned an unexpected unread count.");
  }
  return result.count;
}

export async function markNotificationRead(
  token: string,
  notificationId: string,
): Promise<NexusNotification> {
  const result = await request(
    token,
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH" },
  );
  if (!isNotification(result)) {
    throw new Error("The server returned an unexpected notification response.");
  }
  return result;
}

export async function markAllNotificationsRead(
  token: string,
): Promise<number> {
  const result = await request(token, "/notifications/read-all", {
    method: "PATCH",
  });
  if (!isRecord(result) || typeof result.updated !== "number") {
    throw new Error("The server returned an unexpected notifications response.");
  }
  return result.updated;
}

export async function deleteNotification(
  token: string,
  notificationId: string,
): Promise<void> {
  const result = await request(
    token,
    `/notifications/${encodeURIComponent(notificationId)}`,
    { method: "DELETE" },
  );
  if (!isRecord(result) || result.deleted !== true) {
    throw new Error("The server returned an unexpected notifications response.");
  }
}
