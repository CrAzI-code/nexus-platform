import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getProjectProgress,
  getTaskSummary,
  getWorkspaceInitials,
  type Task,
} from "./dashboard-data";

const tasks: Task[] = [
  { id: "1", workspaceId: "org", projectId: "a", title: "Done", status: "DONE", priority: "LOW", dueDate: "2020-01-01", archivedAt: null },
  { id: "2", workspaceId: "org", projectId: "a", title: "Active", status: "IN_PROGRESS", priority: "HIGH", dueDate: "2999-01-01", archivedAt: null },
  { id: "3", workspaceId: "org", projectId: "b", title: "Late", status: "TODO", priority: "URGENT", dueDate: "2020-01-01", archivedAt: null },
];

describe("dashboard data selectors", () => {
  it("summarizes task state without counting completed work as overdue", () => {
    expect(getTaskSummary(tasks)).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      blocked: 0,
      overdue: 1,
    });
  });

  it("calculates project completion from real task state", () => {
    expect(getProjectProgress(tasks, "a")).toBe(50);
    expect(getProjectProgress(tasks, "missing")).toBe(0);
  });

  it("formats recent timestamps compactly", () => {
    const now = Date.parse("2026-11-02T12:00:00.000Z");
    expect(formatRelativeTime("2026-11-02T11:55:00.000Z", now)).toBe("5m ago");
    expect(formatRelativeTime("invalid", now)).toBe("Unknown time");
  });

  it("keeps workspace initials in sync with renamed organizations", () => {
    expect(getWorkspaceInitials("  Nexus Platform  ")).toBe("NP");
    expect(getWorkspaceInitials("   ")).toBe("NX");
  });
});
