export type OrganizationRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
export type ProjectStatus = "ACTIVE" | "ARCHIVED";

export type OrganizationMembership = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
};

export type OrganizationProject = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  memberCount: number;
  canManage: boolean;
};

export type ProjectInput = {
  name: string;
  description: string | null;
};

export type ProjectMember = {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
};

export type ProjectMembers = {
  members: ProjectMember[];
  availableMembers: ProjectMember[];
  canManage: boolean;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isOrganization(value: unknown): value is OrganizationMembership {
  if (typeof value !== "object" || value === null) return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "slug" in value &&
    typeof value.slug === "string" &&
    "role" in value &&
    (value.role === "OWNER" ||
      value.role === "ADMIN" ||
      value.role === "MANAGER" ||
      value.role === "MEMBER")
  );
}

async function getResponseError(response: Response): Promise<Error> {
  if (response.status === 401) {
    return new Error("Your session has expired. Sign in again to continue.");
  }
  if (response.status === 400) {
    return new Error("Check the submitted information and try again.");
  }
  if (response.status === 403) {
    return new Error("You don’t have permission to perform this action.");
  }
  if (response.status === 404) {
    return new Error("This organization or project is no longer available.");
  }
  if (response.status === 409) {
    return new Error("This project can’t be changed in its current state.");
  }
  return new Error("We couldn’t complete that request. Please try again.");
}

function isOrganizationProject(value: unknown): value is OrganizationProject {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "description" in value &&
    (typeof value.description === "string" || value.description === null) &&
    "status" in value &&
    (value.status === "ACTIVE" || value.status === "ARCHIVED") &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    "taskCount" in value &&
    typeof value.taskCount === "number" &&
    "memberCount" in value &&
    typeof value.memberCount === "number" &&
    "canManage" in value &&
    typeof value.canManage === "boolean"
  );
}

function isProjectMember(value: unknown): value is ProjectMember {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof value.userId === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "email" in value &&
    typeof value.email === "string" &&
    "role" in value &&
    (value.role === "OWNER" ||
      value.role === "ADMIN" ||
      value.role === "MANAGER" ||
      value.role === "MEMBER")
  );
}

function isProjectMembers(value: unknown): value is ProjectMembers {
  return (
    typeof value === "object" &&
    value !== null &&
    "members" in value &&
    Array.isArray(value.members) &&
    value.members.every(isProjectMember) &&
    "availableMembers" in value &&
    Array.isArray(value.availableMembers) &&
    value.availableMembers.every(isProjectMember) &&
    "canManage" in value &&
    typeof value.canManage === "boolean"
  );
}

async function readProject(response: Response): Promise<OrganizationProject> {
  const result: unknown = await response.json();
  if (!isOrganizationProject(result)) {
    throw new Error("The server returned an unexpected project response.");
  }
  return result;
}

async function readProjectMembers(response: Response): Promise<ProjectMembers> {
  const result: unknown = await response.json();
  if (!isProjectMembers(result)) {
    throw new Error(
      "The server returned an unexpected project members response.",
    );
  }
  return result;
}

export async function listOrganizations(
  token: string,
): Promise<OrganizationMembership[]> {
  const response = await fetch(`${apiBaseUrl}/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await getResponseError(response);

  const result: unknown = await response.json();
  if (!Array.isArray(result) || !result.every(isOrganization)) {
    throw new Error("The server returned an unexpected organization response.");
  }
  return result;
}

export async function updateOrganizationName(
  token: string,
  organizationId: string,
  name: string,
): Promise<OrganizationMembership> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.ok) throw await getResponseError(response);

  const result: unknown = await response.json();
  if (!isOrganization(result)) {
    throw new Error("The server returned an unexpected organization response.");
  }
  return result;
}

export async function listProjects(
  token: string,
  organizationId: string,
): Promise<OrganizationProject[]> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw await getResponseError(response);

  const result: unknown = await response.json();
  if (!Array.isArray(result) || !result.every(isOrganizationProject)) {
    throw new Error("The server returned an unexpected projects response.");
  }
  return result;
}

export async function getProject(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<OrganizationProject> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProject(response);
}

export async function createProject(
  token: string,
  organizationId: string,
  input: ProjectInput,
): Promise<OrganizationProject> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProject(response);
}

export async function updateProject(
  token: string,
  organizationId: string,
  projectId: string,
  input: ProjectInput,
): Promise<OrganizationProject> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProject(response);
}

export async function archiveProject(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<OrganizationProject> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/archive`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProject(response);
}

export async function restoreProject(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<OrganizationProject> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/restore`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProject(response);
}

export async function listProjectMembers(
  token: string,
  organizationId: string,
  projectId: string,
): Promise<ProjectMembers> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/members`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw await getResponseError(response);
  return readProjectMembers(response);
}

export async function addProjectMember(
  token: string,
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<ProjectMember> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    },
  );
  if (!response.ok) throw await getResponseError(response);
  const result: unknown = await response.json();
  if (!isProjectMember(result)) {
    throw new Error(
      "The server returned an unexpected project member response.",
    );
  }
  return result;
}

export async function removeProjectMember(
  token: string,
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) throw await getResponseError(response);
}

export async function createOrganization(
  token: string,
  name: string,
): Promise<OrganizationMembership> {
  const response = await fetch(`${apiBaseUrl}/organizations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await getResponseError(response);

  const result: unknown = await response.json();
  if (!isOrganization(result)) {
    throw new Error("The server returned an unexpected organization response.");
  }
  return result;
}
