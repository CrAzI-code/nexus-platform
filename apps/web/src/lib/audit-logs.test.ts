import { afterEach, describe, expect, it, vi } from "vitest";
import { listOrganizationAuditLogs } from "./audit-logs";

describe("organization audit log client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["INVITATION_RESENT", "INVITATION_DECLINED"] as const)(
    "accepts the %s audit action",
    async (action) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "audit-log-id",
                  organizationId: "organization-id",
                  actorId: "actor-id",
                  actorName: "Team Admin",
                  action,
                  targetType: "INVITATION",
                  targetId: "invitation-id",
                  before: { status: "PENDING" },
                  after: { status: action === "INVITATION_DECLINED" ? "DECLINED" : "PENDING" },
                  createdAt: "2026-11-03T00:00:00.000Z",
                },
              ],
              page: 1,
              pageSize: 25,
              hasMore: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(
        listOrganizationAuditLogs("session-token", "organization-id", {
          page: 1,
          pageSize: 25,
        }),
      ).resolves.toMatchObject({ items: [{ action }] });
    },
  );
});
