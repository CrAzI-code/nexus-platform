import { afterEach, describe, expect, it, vi } from "vitest";
import { updateOrganizationName } from "./organizations";

describe("organization profile API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a bearer-authenticated organization name update", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "org-id",
          name: "Updated workspace",
          slug: "old-workspace",
          role: "ADMIN",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateOrganizationName("session-token", "org/123", "Updated workspace"),
    ).resolves.toEqual({
      id: "org-id",
      name: "Updated workspace",
      slug: "old-workspace",
      role: "ADMIN",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/org%2F123"),
      expect.objectContaining({
        method: "PATCH",
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Updated workspace" }),
      }),
    );
  });

  it("rejects unexpected update responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "org-id", name: "Updated" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      updateOrganizationName("session-token", "org-id", "Updated"),
    ).rejects.toThrow("unexpected organization response");
  });
});
