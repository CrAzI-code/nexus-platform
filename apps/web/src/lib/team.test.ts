import { afterEach, describe, expect, it, vi } from "vitest";
import {
  declineOrganizationInvitation,
  declineOrganizationInvitationById,
  resendOrganizationInvitation,
} from "./team";

const invitationId = "42da5769-a178-4f22-96ac-39e1299b824a";
const organizationId = "a4d980b7-6493-4f82-92d4-0dd8c41dba14";
const invitationToken = "a".repeat(64);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("organization team API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resends invitations and validates the rotated share token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        invitation: {
          id: invitationId,
          email: "invitee@example.com",
          role: "MEMBER",
          status: "PENDING",
          expiresAt: "2026-11-09T00:00:00.000Z",
          createdAt: "2026-11-02T00:00:00.000Z",
        },
        invitationToken,
        emailDeliveryStatus: "failed",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resendOrganizationInvitation("session-token", organizationId, invitationId),
    ).resolves.toMatchObject({
      invitation: { id: invitationId, status: "PENDING" },
      invitationToken,
      emailDeliveryStatus: "failed",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:4000/organizations/${organizationId}/invitations/${invitationId}/resend`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    ["token", declineOrganizationInvitation, "/invitations/decline"],
    [
      "notification",
      declineOrganizationInvitationById,
      `/invitations/${invitationId}/decline`,
    ],
  ] as const)(
    "declines an invitation from a %s link",
    async (_source, decline, expectedPath) => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ organizationId, status: "DECLINED" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result =
        decline === declineOrganizationInvitation
          ? await decline("session-token", invitationToken)
          : await decline("session-token", invitationId);

      expect(result).toEqual({ organizationId, status: "DECLINED" });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `http://localhost:4000${expectedPath}`,
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
        headers: { Authorization: "Bearer session-token" },
      });
    },
  );
});
