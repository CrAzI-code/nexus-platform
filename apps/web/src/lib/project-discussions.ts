export type DiscussionMessage = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
};

export type ProjectDiscussion = {
  id: string;
  title: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: {
    id: string;
    authorName: string;
    body: string;
    createdAt: string;
    deletedAt: string | null;
  } | null;
  isUnread: boolean;
};

export type ProjectDiscussionPage = {
  items: ProjectDiscussion[];
  nextCursor: string | null;
};

export type DiscussionMessagePage = {
  items: DiscussionMessage[];
  hasMore: boolean;
  nextCursor: string | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMessage(value: unknown): value is DiscussionMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.authorId === "string" &&
    typeof value.authorName === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isNullableDate(value.editedAt) &&
    isNullableDate(value.deletedAt) &&
    typeof value.canEdit === "boolean" &&
    typeof value.canDelete === "boolean"
  );
}

function isDiscussion(value: unknown): value is ProjectDiscussion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.createdById !== "string" ||
    typeof value.createdByName !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.isUnread !== "boolean"
  ) {
    return false;
  }
  if (value.lastMessage === null) return true;
  return (
    isRecord(value.lastMessage) &&
    typeof value.lastMessage.id === "string" &&
    typeof value.lastMessage.authorName === "string" &&
    typeof value.lastMessage.body === "string" &&
    typeof value.lastMessage.createdAt === "string" &&
    isNullableDate(value.lastMessage.deletedAt)
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
    if (response.status === 403) {
      throw new Error("You don’t have permission to change this discussion.");
    }
    if (response.status === 404) {
      throw new Error("This project or discussion is no longer available.");
    }
    if (response.status === 409) {
      throw new Error("Archived projects cannot change discussions.");
    }
    if (response.status === 400) {
      throw new Error("Check your message and try again.");
    }
    throw new Error("We couldn’t complete that discussion request.");
  }
  return response.json();
}

function discussionPath(organizationId: string, projectId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/discussions`;
}

function readDiscussionPage(value: unknown): ProjectDiscussionPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isDiscussion) ||
    !(typeof value.nextCursor === "string" || value.nextCursor === null)
  ) {
    throw new Error("The server returned invalid project discussions.");
  }
  return { items: value.items, nextCursor: value.nextCursor };
}

function readMessagePage(value: unknown): DiscussionMessagePage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isMessage) ||
    typeof value.hasMore !== "boolean" ||
    !(typeof value.nextCursor === "string" || value.nextCursor === null)
  ) {
    throw new Error("The server returned invalid discussion messages.");
  }
  return {
    items: value.items,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor,
  };
}

function readMessage(value: unknown): DiscussionMessage {
  if (!isMessage(value)) {
    throw new Error("The server returned an invalid discussion message.");
  }
  return value;
}

function readDiscussion(value: unknown): ProjectDiscussion {
  if (!isDiscussion(value)) {
    throw new Error("The server returned an invalid discussion.");
  }
  return value;
}

export async function listProjectDiscussions(
  token: string,
  organizationId: string,
  projectId: string,
  before?: string | null,
): Promise<ProjectDiscussionPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return readDiscussionPage(
    await request(token, `${discussionPath(organizationId, projectId)}${query}`),
  );
}

export async function createProjectDiscussion(
  token: string,
  organizationId: string,
  projectId: string,
  title: string,
  body: string,
): Promise<ProjectDiscussion> {
  return readDiscussion(
    await request(token, discussionPath(organizationId, projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    }),
  );
}

export async function listDiscussionMessages(
  token: string,
  organizationId: string,
  projectId: string,
  discussionId: string,
  before?: string | null,
): Promise<DiscussionMessagePage> {
  const query = new URLSearchParams({ limit: "30" });
  if (before) query.set("before", before);
  const path = `${discussionPath(organizationId, projectId)}/${encodeURIComponent(discussionId)}/messages?${query}`;
  return readMessagePage(await request(token, path));
}

export async function postDiscussionMessage(
  token: string,
  organizationId: string,
  projectId: string,
  discussionId: string,
  body: string,
): Promise<DiscussionMessage> {
  const path = `${discussionPath(organizationId, projectId)}/${encodeURIComponent(discussionId)}/messages`;
  return readMessage(
    await request(token, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),
  );
}

export async function editDiscussionMessage(
  token: string,
  organizationId: string,
  projectId: string,
  discussionId: string,
  messageId: string,
  body: string,
): Promise<DiscussionMessage> {
  const path = `${discussionPath(organizationId, projectId)}/${encodeURIComponent(discussionId)}/messages/${encodeURIComponent(messageId)}`;
  return readMessage(
    await request(token, path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),
  );
}

export async function deleteDiscussionMessage(
  token: string,
  organizationId: string,
  projectId: string,
  discussionId: string,
  messageId: string,
): Promise<DiscussionMessage> {
  const path = `${discussionPath(organizationId, projectId)}/${encodeURIComponent(discussionId)}/messages/${encodeURIComponent(messageId)}`;
  return readMessage(await request(token, path, { method: "DELETE" }));
}

export async function markProjectDiscussionRead(
  token: string,
  organizationId: string,
  projectId: string,
  discussionId: string,
): Promise<void> {
  const path = `${discussionPath(organizationId, projectId)}/${encodeURIComponent(discussionId)}/read`;
  await request(token, path, { method: "POST" });
}
