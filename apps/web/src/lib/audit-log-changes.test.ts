import { describe, expect, it } from "vitest";
import {
  formatAuditFieldValue,
  getAuditResourceName,
  getAuditFieldChanges,
} from "./audit-log-changes";

describe("getAuditFieldChanges", () => {
  it("formats separate changed fields and enum labels", () => {
    expect(
      getAuditFieldChanges(
        { priority: "HIGH", status: "IN_PROGRESS" },
        { priority: "URGENT", status: "DONE" },
      ),
    ).toEqual([
      { field: "Priority", before: "HIGH", after: "URGENT" },
      { field: "Status", before: "IN_PROGRESS", after: "DONE" },
    ]);

    expect(formatAuditFieldValue("HIGH")).toBe("High");
    expect(formatAuditFieldValue("IN_PROGRESS")).toBe("In Progress");
  });

  it("flattens nested fields and reports additions or removals", () => {
    expect(
      getAuditFieldChanges(
        { settings: { taskStatus: "IN_PROGRESS", note: null } },
        { settings: { taskStatus: "DONE", addedField: "ready" } },
      ),
    ).toEqual([
      {
        field: "Settings · Added Field",
        before: null,
        after: "ready",
      },
      {
        field: "Settings · Task Status",
        before: "IN_PROGRESS",
        after: "DONE",
      },
    ]);
  });

  it("returns no rows for identical snapshots", () => {
    expect(
      getAuditFieldChanges({ priority: "HIGH" }, { priority: "HIGH" }),
    ).toEqual([]);
    expect(
      getAuditFieldChanges(
        { preferences: { alerts: ["email", "push"] } },
        { preferences: { alerts: ["email", "push"] } },
      ),
    ).toEqual([]);
  });

  it("formats null, booleans, arrays, and nested structured values safely", () => {
    expect(formatAuditFieldValue(null)).toBe("Not set");
    expect(formatAuditFieldValue("")).toBe("Not set");
    expect(formatAuditFieldValue(true)).toBe("Yes");
    expect(formatAuditFieldValue(["IN_PROGRESS", null])).toBe(
      "In Progress, Not set",
    );
    expect(
      formatAuditFieldValue({ notificationMode: "IN_APP", enabled: false }),
    ).toBe("Notification Mode: In App · Enabled: No");
  });

  it("handles empty snapshots and deep nesting without throwing", () => {
    expect(getAuditFieldChanges({}, { priority: "HIGH" })).toEqual([
      { field: "Priority", before: null, after: "HIGH" },
    ]);

    let deeplyNested: unknown = "value";
    for (let depth = 0; depth < 100; depth += 1) {
      deeplyNested = { nested: deeplyNested };
    }
    expect(() => getAuditFieldChanges(deeplyNested, null)).not.toThrow();
    expect(formatAuditFieldValue(deeplyNested)).toMatch(/Complex value$/);
  });

  it("does not expose internal identifiers or sensitive fields", () => {
    expect(
      getAuditFieldChanges(
        { projectId: "ca4f89d3-1ca5-4d14-a2f2-1089d7afeb20", token: "old" },
        { projectId: "dde30ed6-c027-4b88-92f6-9d32d829a4b1", token: "new" },
      ),
    ).toEqual([]);
  });

  it("finds a readable resource name in current or previous snapshots", () => {
    expect(
      getAuditResourceName(
        { project: { title: "Website refresh" } },
        { project: { title: "Website launch" } },
      ),
    ).toBe("Website launch");
    expect(getAuditResourceName({ fileName: "brief.pdf" }, null)).toBe(
      "brief.pdf",
    );
  });
});
