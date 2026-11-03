export type DashboardAnchor = "home" | "my-tasks" | "projects" | "notifications";

export function organizationDashboardPath(
  organizationId: string,
  anchor?: DashboardAnchor,
): string {
  const path = `/?organizationId=${encodeURIComponent(organizationId)}`;
  return anchor && anchor !== "home" ? `${path}#${anchor}` : path;
}

export function organizationMembersPath(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/members`;
}

export function organizationAuditLogsPath(organizationId: string): string {
  return `/organizations/${encodeURIComponent(organizationId)}/audit-logs`;
}
