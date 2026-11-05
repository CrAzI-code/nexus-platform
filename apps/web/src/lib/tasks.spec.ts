import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectTaskBlocker,
  getTaskErrorMessage,
  getProjectTask,
  resolveProjectTaskBlocker,
} from "./tasks";

function taskDetails() {
  return {
    id: "task-id",
    projectId: "project-id",
    projectName: "Launch",
    projectStatus: "ACTIVE",
    title: "Prepare launch",
    description: null,
    status: "BLOCKED",
    priority: "MEDIUM",
    dueAt: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    creator: { id: "user-id", name: "Jordan" },
    assignee: null,
    commentCount: 0,
    canManage: true,
    canAssignOthers: true,
    canParticipate: true,
    activeBlocker: {
      id: "blocker-id",
      reason: "Waiting on access.",
      createdById: "user-id",
      createdByName: "Jordan",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    comments: [],
    activity: [
      {
        id: "activity-id",
        actorId: "user-id",
        actorName: "Jordan",
        type: "BLOCKER_CREATED",
        message: "Marked this task as blocked: Waiting on access.",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    blockerHistory: [
      {
        id: "blocker-id",
        reason: "Waiting on access.",
        createdById: "user-id",
        createdByName: "Jordan",
        createdAt: "2026-01-02T00:00:00.000Z",
        resolvedById: null,
        resolvedByName: null,
        resolvedAt: null,
      },
    ],
  };
}

describe("task blocker API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads task details from the task route with the blocker-aware response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(taskDetails()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getProjectTask(
        "session-token",
        "org-id",
        "project-id",
        "task-id",
      ),
    ).resolves.toMatchObject({
      id: "task-id",
      activeBlocker: { id: "blocker-id" },
      blockerHistory: [{ reason: "Waiting on access.", resolvedAt: null }],
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/organizations/org-id/projects/project-id/tasks/task-id",
    );
    expect(options).toMatchObject({
      headers: { Authorization: expect.stringMatching(/^Bearer /u) },
    });
  });

  it("creates blockers through the authenticated task API and validates history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(taskDetails()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProjectTaskBlocker(
        "session-token",
        "org/id",
        "project/id",
        "task/id",
        " Waiting on access. ",
      ),
    ).resolves.toMatchObject({
      activeBlocker: { reason: "Waiting on access." },
      blockerHistory: [{ reason: "Waiting on access.", resolvedAt: null }],
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/organizations/org%2Fid/projects/project%2Fid/tasks/task%2Fid/blockers",
    );
    expect(options).toMatchObject({
      method: "POST",
      body: JSON.stringify({ reason: " Waiting on access. " }),
    });
  });

  it("resolves the selected blocker through an authorized API route", async () => {
    const resolved = {
      ...taskDetails(),
      status: "IN_PROGRESS",
      activeBlocker: null,
      blockerHistory: [
        {
          ...taskDetails().blockerHistory[0],
          resolvedById: "user-id",
          resolvedByName: "Jordan",
          resolvedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(resolved), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveProjectTaskBlocker(
        "session-token",
        "org-id",
        "project-id",
        "task-id",
        "blocker-id",
      ),
    ).resolves.toMatchObject({
      activeBlocker: null,
      blockerHistory: [{ resolvedByName: "Jordan" }],
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/tasks/task-id/blockers/blocker-id/resolve",
    );
    expect(options).toMatchObject({ method: "PATCH" });
  });

  it("rejects incomplete blocker responses instead of hiding missing history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...taskDetails(), blockerHistory: undefined }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      resolveProjectTaskBlocker(
        "session-token",
        "org-id",
        "project-id",
        "task-id",
        "blocker-id",
      ),
    ).rejects.toThrow("unexpected task response");
  });

  it("rejects task details that omit project-member capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...taskDetails(), canParticipate: undefined }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      getProjectTask("session-token", "org-id", "project-id", "task-id"),
    ).rejects.toThrow("unexpected task response");
  });

  it("preserves HTTP status and extracts a readable message from structured API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            statusCode: 500,
            message: { message: "Task details are temporarily unavailable." },
            error: "Internal Server Error",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const request = getProjectTask(
      "session-token",
      "org-id",
      "project-id",
      "task-id",
    );
    await expect(request).rejects.toMatchObject({
      name: "TaskApiError",
      status: 500,
      message: "Task details are temporarily unavailable.",
      responseBody: {
        statusCode: 500,
        message: { message: "Task details are temporarily unavailable." },
      },
    });
  });

  it("never renders object-coerced Error messages as [object Object]", () => {
    const wrappedError = Object.assign(new Error(), {
      message: "[object Object]",
      cause: { message: "Task details could not be loaded." },
    });

    expect(
      getTaskErrorMessage(
        wrappedError,
        "We couldn’t load this task. Please try again.",
      ),
    ).toBe("Task details could not be loaded.");
    expect(
      getTaskErrorMessage(
        { code: "UNKNOWN" },
        "We couldn’t load this task. Please try again.",
      ),
    ).toBe("We couldn’t load this task. Please try again.");
  });
});
