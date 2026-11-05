import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectDiscussion,
  deleteDiscussionMessage,
  listDiscussionMessages,
  listProjectDiscussions,
  postDiscussionMessage,
} from "./project-discussions";
import { listNotifications } from "./notifications";

const message = {
  id: "message-id",
  authorId: "member-id",
  authorName: "Jordan Lee",
  body: "Ready to ship?",
  createdAt: "2026-11-04T10:00:00.000Z",
  updatedAt: "2026-11-04T10:00:00.000Z",
  editedAt: null,
  deletedAt: null,
  canEdit: true,
  canDelete: true,
};

const discussion = {
  id: "discussion-id",
  title: "Release notes",
  createdById: "member-id",
  createdByName: "Jordan Lee",
  createdAt: "2026-11-04T10:00:00.000Z",
  updatedAt: "2026-11-04T10:00:00.000Z",
  lastMessage: {
    id: message.id,
    authorName: message.authorName,
    body: message.body,
    createdAt: message.createdAt,
    deletedAt: null,
  },
  isUnread: false,
};

describe("project discussion API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads scoped discussion history and safely encodes the pagination cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [discussion], nextCursor: "older|cursor" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listProjectDiscussions(
        "session-token",
        "org/id",
        "project/id",
        "2026-11-04T10:00:00.000Z|message-id",
      ),
    ).resolves.toMatchObject({
      items: [{ id: "discussion-id", isUnread: false }],
      nextCursor: "older|cursor",
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/organizations/org%2Fid/projects/project%2Fid/discussions?before=",
    );
    expect(options).toMatchObject({
      headers: { Authorization: "Bearer session-token" },
    });
  });

  it("creates a discussion with its opening message through the project route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(discussion), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProjectDiscussion(
        "session-token",
        "org-id",
        "project-id",
        "Release notes",
        "Ready to ship?",
      ),
    ).resolves.toMatchObject({ id: "discussion-id" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Release notes", body: "Ready to ship?" }),
    });
  });

  it("loads messages oldest-first from the requested discussion history endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [message], hasMore: true, nextCursor: "older" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listDiscussionMessages(
        "session-token",
        "org-id",
        "project-id",
        "discussion-id",
      ),
    ).resolves.toMatchObject({
      items: [{ id: "message-id" }],
      hasMore: true,
      nextCursor: "older",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/discussions/discussion-id/messages?limit=30",
    );
  });

  it("posts and soft-deletes messages using the discussion-scoped routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(message), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...message, body: "", deletedAt: message.updatedAt }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await postDiscussionMessage(
      "session-token",
      "org-id",
      "project-id",
      "discussion-id",
      "Another thought",
    );
    await deleteDiscussionMessage(
      "session-token",
      "org-id",
      "project-id",
      "discussion-id",
      "message-id",
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ body: "Another thought" }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("rejects malformed discussion responses instead of accepting partial data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ id: "missing-fields" }], nextCursor: null }), {
          status: 200,
        }),
      ),
    );

    await expect(
      listProjectDiscussions("session-token", "org-id", "project-id"),
    ).rejects.toThrow("The server returned invalid project discussions.");
  });

  it("accepts persisted project-discussion notifications for the live inbox", async () => {
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
                type: "PROJECT_DISCUSSION_MESSAGE",
                title: "New message in Release notes",
                message: "Ready to ship?",
                resourceType: "PROJECT",
                resourceId: "project-id",
                readAt: null,
                createdAt: "2026-11-04T10:00:00.000Z",
              },
            ],
            page: 1,
            pageSize: 20,
            hasMore: false,
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listNotifications("session-token")).resolves.toMatchObject({
      items: [{ type: "PROJECT_DISCUSSION_MESSAGE" }],
    });
  });
});
