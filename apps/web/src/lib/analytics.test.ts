import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrganizationAnalytics, getProjectAnalytics } from "./analytics";

afterEach(() => vi.unstubAllGlobals());

describe("analytics API client", () => {
  it("requests organization analytics with date and project filters", async () => {
    const payload = {
      projects: { total: 1, active: 1 },
      tasks: { total: 0, completed: 0, inProgress: 0, overdue: 0, blocked: 0 },
      projectOptions: [],
      projectCompletion: [],
      recentActivity: [],
      workload: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrganizationAnalytics("token", "org id", {
      days: 7,
      projectId: "project-id",
    })).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/org%20id/analytics?days=7&projectId=project-id"),
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("sends the project status filter and rejects malformed responses", async () => {
    const validPayload = {
      project: { id: "project", name: "Project", status: "ACTIVE" },
      tasks: { total: 0, completed: 0, inProgress: 0, overdue: 0, blocked: 0, completionPercentage: 0 },
      blockers: { total: 0, unresolved: 0, resolved: 0 },
      activityByDay: [],
      workload: [],
      recentlyCompleted: [],
      overdueWork: [],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(validPayload)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProjectAnalytics("token", "org", "project", {
      days: 30,
      status: "BLOCKED",
    })).resolves.toEqual(validPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("days=30&status=BLOCKED"),
      { headers: { Authorization: "Bearer token" } },
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] })));
    await expect(getOrganizationAnalytics("token", "org", { days: 30 })).rejects.toThrow(
      "unexpected analytics response",
    );
  });
});