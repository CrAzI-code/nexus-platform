export type OrganizationRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";

export type OrganizationMembership = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
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
    return new Error("Enter an organization name between 1 and 100 characters.");
  }
  return new Error("We couldn’t complete that request. Please try again.");
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
