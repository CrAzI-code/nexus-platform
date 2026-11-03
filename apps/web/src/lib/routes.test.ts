import { describe, expect, it } from "vitest";
import {
  organizationAuditLogsPath,
  organizationDashboardPath,
  organizationFilesPath,
  organizationMembersPath,
} from "./routes";

describe("organization navigation routes", () => {
  it("builds a direct organization-aware Home URL", () => {
    expect(organizationDashboardPath("org-123")).toBe(
      "/?organizationId=org-123",
    );
  });

  it("adds dashboard anchors without relying on browser history", () => {
    expect(organizationDashboardPath("org 123", "projects")).toBe(
      "/?organizationId=org%20123#projects",
    );
    expect(organizationDashboardPath("org 123", "my-tasks")).toBe(
      "/?organizationId=org%20123#my-tasks",
    );
  });

  it("builds direct People and Audit Logs routes", () => {
    expect(organizationMembersPath("org/123")).toBe(
      "/organizations/org%2F123/members",
    );
    expect(organizationAuditLogsPath("org/123")).toBe(
      "/organizations/org%2F123/audit-logs",
    );
    expect(organizationFilesPath("org/123")).toBe(
      "/organizations/org%2F123/files",
    );
  });
});
