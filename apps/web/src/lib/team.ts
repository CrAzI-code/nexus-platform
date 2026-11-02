import type { OrganizationRole } from "./organizations";

export type ManagedMemberRole = Exclude<OrganizationRole, "OWNER">;

export type OrganizationMember = {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
};

export type OrganizationInvitation = {
  id: string;
  email: string;
  role: ManagedMemberRole;
  status: "PENDING" | "REVOKED";
  expiresAt: string;
  createdAt: string;
};

export type OrganizationTeam = {
  organization: { id: string; name: string };
  currentUserRole: OrganizationRole;
  canManage: boolean;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
};

export type CreatedOrganizationInvitation = {
  invitation: OrganizationInvitation;
  invitationToken: string;
  emailDeliveryStatus: "sent" | "unavailable" | "failed";
};

export type AcceptedOrganizationInvitation = {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
};

export type InvitationAcceptanceDetails = {
  id: string;
  organizationName: string;
  expiresAt: string;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const organizationRoles = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;
const managedRoles = ["ADMIN", "MANAGER", "MEMBER"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return organizationRoles.some((role) => role === value);
}

function isManagedRole(value: unknown): value is ManagedMemberRole {
  return managedRoles.some((role) => role === value);
}

function isMember(value: unknown): value is OrganizationMember {
  return (
    isRecord(value) &&
    typeof value.userId === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    isOrganizationRole(value.role) &&
    typeof value.joinedAt === "string"
  );
}

function isInvitation(value: unknown): value is OrganizationInvitation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    isManagedRole(value.role) &&
    (value.status === "PENDING" || value.status === "REVOKED") &&
    typeof value.expiresAt === "string" &&
    typeof value.createdAt === "string"
  );
}

function isTeam(value: unknown): value is OrganizationTeam {
  return (
    isRecord(value) &&
    isRecord(value.organization) &&
    typeof value.organization.id === "string" &&
    typeof value.organization.name === "string" &&
    isOrganizationRole(value.currentUserRole) &&
    typeof value.canManage === "boolean" &&
    Array.isArray(value.members) &&
    value.members.every(isMember) &&
    Array.isArray(value.invitations) &&
    value.invitations.every(isInvitation)
  );
}

async function responseError(response: Response): Promise<Error> {
  let message = "";
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isRecord(body) && typeof body.message === "string") {
    message = body.message;
  }

  if (response.status === 400) {
    if (message.toLowerCase().includes("invitation link is invalid")) {
      return new Error("This invitation link is invalid. Ask for a new link.");
    }
    return new Error("Check the invitation link and try again.");
  }
  if (response.status === 403) {
    if (message.includes("email address this invitation was sent to")) {
      return new Error(
        "This invitation was sent to a different email address. Sign in with the invited account.",
      );
    }
    if (message.includes("Verify the email address")) {
      return new Error(
        "Verify the primary email on your NEXUS account, then try accepting the invitation again.",
      );
    }
    return new Error("You don’t have permission to accept this invitation.");
  }
  if (response.status === 404 && message.includes("Invitation not found")) {
    return new Error("This invitation link is invalid or no longer available.");
  }
  if (response.status === 409) {
    if (message.includes("has expired")) {
      return new Error("This invitation has expired. Ask for a new invitation link.");
    }
    if (message.includes("has been revoked")) {
      return new Error("This invitation was revoked by an organization Admin.");
    }
    if (message.includes("already been used")) {
      return new Error("This invitation has already been accepted.");
    }
    if (message.includes("active invitation already exists")) {
      return new Error("An active invitation already exists for this email.");
    }
    if (message.includes("already a member")) {
      return new Error("This person is already a member of the organization.");
    }
    if (message.includes("Owner cannot be demoted or removed")) {
      return new Error("The organization Owner cannot be demoted or removed.");
    }
  }

  if (response.status === 401) {
    return new Error("Your session has expired. Sign in again to continue.");
  }
  if (response.status === 400) {
    return new Error("Check the submitted information and try again.");
  }
  if (response.status === 404) {
    return new Error("This organization or invitation is no longer available.");
  }
  if (response.status === 409) {
    return new Error("This team change conflicts with the current organization state.");
  }
  if (response.status === 422) {
    return new Error(
      "Your NEXUS account needs a primary email address before it can accept invitations.",
    );
  }
  if (response.status === 429) {
    return new Error("Too many attempts. Wait a moment, then try again.");
  }
  if (response.status >= 500) {
    return new Error(
      "NEXUS couldn’t accept the invitation right now. It hasn’t been used; please try again shortly.",
    );
  }
  return new Error("We couldn’t complete that request. Please try again.");
}

async function teamRequest(
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
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "NEXUS couldn’t reach the API. Check your connection and try again.",
      );
    }
    throw error;
  }
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function organizationPath(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}`;
}

export async function getOrganizationTeam(
  token: string,
  organizationId: string,
): Promise<OrganizationTeam> {
  const result = await teamRequest(
    token,
    `${organizationPath(organizationId)}/members`,
  );
  if (!isTeam(result)) {
    throw new Error("The server returned an unexpected team response.");
  }
  return result;
}

export async function inviteOrganizationMember(
  token: string,
  organizationId: string,
  email: string,
  role: ManagedMemberRole,
): Promise<CreatedOrganizationInvitation> {
  const result = await teamRequest(
    token,
    `${organizationPath(organizationId)}/invitations`,
    {
      method: "POST",
      body: JSON.stringify({ email, role }),
    },
  );
  if (
    !isRecord(result) ||
    !isInvitation(result.invitation) ||
    (result.emailDeliveryStatus !== "sent" &&
      result.emailDeliveryStatus !== "unavailable" &&
      result.emailDeliveryStatus !== "failed") ||
    !/^[a-f0-9]{64}$/iu.test(
      typeof result.invitationToken === "string"
        ? result.invitationToken
        : "",
    )
  ) {
    throw new Error("The server returned an unexpected invitation response.");
  }
  const invitationToken = result.invitationToken;
  const invitation = result.invitation;
  if (typeof invitationToken !== "string" || !isInvitation(invitation)) {
    throw new Error("The server returned an unexpected invitation response.");
  }
  return {
    invitation,
    invitationToken,
    emailDeliveryStatus: result.emailDeliveryStatus,
  };
}

export async function revokeOrganizationInvitation(
  token: string,
  organizationId: string,
  invitationId: string,
): Promise<OrganizationInvitation> {
  const result = await teamRequest(
    token,
    `${organizationPath(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );
  if (!isInvitation(result)) {
    throw new Error("The server returned an unexpected invitation response.");
  }
  return result;
}

export async function updateOrganizationMemberRole(
  token: string,
  organizationId: string,
  userId: string,
  role: ManagedMemberRole,
): Promise<OrganizationMember> {
  const result = await teamRequest(
    token,
    `${organizationPath(organizationId)}/members/${encodeURIComponent(userId)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  if (!isMember(result)) {
    throw new Error("The server returned an unexpected member response.");
  }
  return result;
}

export async function removeOrganizationMember(
  token: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  await teamRequest(
    token,
    `${organizationPath(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

export async function acceptOrganizationInvitation(
  token: string,
  invitationToken: string,
): Promise<AcceptedOrganizationInvitation> {
  const result = await teamRequest(token, "/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token: invitationToken }),
  });
  if (
    !isRecord(result) ||
    typeof result.organizationId !== "string" ||
    typeof result.organizationName !== "string" ||
    !isOrganizationRole(result.role)
  ) {
    throw new Error("The server returned an unexpected acceptance response.");
  }
  return {
    organizationId: result.organizationId,
    organizationName: result.organizationName,
    role: result.role,
  };
}

export async function getInvitationAcceptanceDetails(
  token: string,
  invitationId: string,
): Promise<InvitationAcceptanceDetails> {
  const result = await teamRequest(
    token,
    `/invitations/${encodeURIComponent(invitationId)}`,
  );
  if (
    !isRecord(result) ||
    result.id !== invitationId ||
    typeof result.organizationName !== "string" ||
    typeof result.expiresAt !== "string"
  ) {
    throw new Error("The server returned an unexpected invitation response.");
  }
  return {
    id: result.id,
    organizationName: result.organizationName,
    expiresAt: result.expiresAt,
  };
}

export async function acceptOrganizationInvitationById(
  token: string,
  invitationId: string,
): Promise<AcceptedOrganizationInvitation> {
  const result = await teamRequest(
    token,
    `/invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: "POST" },
  );
  if (
    !isRecord(result) ||
    typeof result.organizationId !== "string" ||
    typeof result.organizationName !== "string" ||
    !isOrganizationRole(result.role)
  ) {
    throw new Error("The server returned an unexpected invitation response.");
  }
  return {
    organizationId: result.organizationId,
    organizationName: result.organizationName,
    role: result.role,
  };
}
