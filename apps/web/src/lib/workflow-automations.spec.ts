import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowAutomation,
  type WorkflowAutomation,
  type WorkflowAutomationInput,
} from "./workflow-automations";
import { listNotifications } from "./notifications";

const automation: WorkflowAutomation = {
  id: "automation-id",
  name: "Notify urgent work",
  trigger: "TASK_CREATED",
  conditionPriority: "URGENT",
  conditionStatus: null,
  conditionAssigneeId: null,
  action: "SEND_NOTIFICATION",
  actionValue: "Please review this task.",
  actionAssigneeId: null,
  enabled: true,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  executions: [],
};

describe("workflow automation API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a rule using the organization and project-scoped endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(automation), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const input: WorkflowAutomationInput = {
      name: automation.name,
      trigger: automation.trigger,
      conditionPriority: automation.conditionPriority,
      conditionStatus: null,
      conditionAssigneeId: null,
      action: automation.action,
      actionValue: automation.actionValue,
      actionAssigneeId: null,
    };

    await expect(
      createWorkflowAutomation("session-token", "org-id", "project-id", input),
    ).resolves.toEqual(automation);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/org-id/projects/project-id/automations"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
        body: JSON.stringify(input),
      }),
    );
  });

  it("accepts in-app notifications emitted by workflow actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "notification-id",
                organizationId: "org-id",
                projectId: "project-id",
                type: "WORKFLOW_AUTOMATION",
                title: "Automation: Notify urgent work",
                message: "Please review this task.",
                resourceType: "TASK",
                resourceId: "task-id",
                readAt: null,
                createdAt: "2026-11-05T00:00:00.000Z",
              },
            ],
            page: 1,
            pageSize: 20,
            hasMore: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(listNotifications("session-token")).resolves.toMatchObject({
      items: [{ type: "WORKFLOW_AUTOMATION" }],
    });
  });
});