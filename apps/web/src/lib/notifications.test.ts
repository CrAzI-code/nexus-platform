import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeNotificationStream, listNotifications } from "./notifications";

describe("notification API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    "TASK_DUE_DATE",
    "TASK_OVERDUE",
    "WORKFLOW_AUTOMATION",
    "PROJECT_DISCUSSION_MESSAGE",
  ] as const)(
    "accepts the %s notification type returned by the API",
    async (type) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "notification-id",
                  organizationId: "organization-id",
                  projectId: "project-id",
                  type,
                  title: "Task update",
                  message: "A task you follow has an update.",
                  resourceType: "TASK",
                  resourceId: "task-id",
                  readAt: null,
                  createdAt: "2026-11-03T00:00:00.000Z",
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
        items: [{ type }],
      });
    },
  );

  it("sends the last SSE cursor and parses a replayed event id", async () => {
    const notification = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      organizationId: "123e4567-e89b-42d3-a456-426614174001",
      projectId: "123e4567-e89b-42d3-a456-426614174002",
      type: "TASK_OVERDUE",
      title: "Task is overdue",
      message: "A task you follow has passed its due date.",
      resourceType: "TASK",
      resourceId: "123e4567-e89b-42d3-a456-426614174003",
      readAt: null,
      createdAt: "2026-11-03T10:00:00.000Z",
    };
    const eventId = `${notification.createdAt}|${notification.id}`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `id: ${eventId}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`,
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onNotification = vi.fn();

    await consumeNotificationStream(
      "session-token",
      new AbortController().signal,
      onNotification,
      vi.fn(),
      eventId,
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer session-token",
        "Last-Event-ID": eventId,
      },
    });
    expect(onNotification).toHaveBeenCalledWith(notification, eventId);
  });
});
