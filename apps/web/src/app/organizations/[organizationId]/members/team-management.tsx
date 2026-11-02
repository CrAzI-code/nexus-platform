"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  getOrganizationTeam,
  inviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
  type ManagedMemberRole,
  type OrganizationTeam,
} from "@/lib/team";

const managedRoles: ManagedMemberRole[] = ["ADMIN", "MANAGER", "MEMBER"];

function isManagedMemberRole(value: string): value is ManagedMemberRole {
  return managedRoles.some((item) => item === value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function TeamManagement({
  organizationId,
}: {
  organizationId: string;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [team, setTeam] = useState<OrganizationTeam | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ManagedMemberRole>("MEMBER");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadTeam() {
      if (!isSignedIn) {
        setError("Sign in to view this organization’s team.");
        setIsLoading(false);
        return;
      }

      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const result = await getOrganizationTeam(token, organizationId);
        if (active) {
          setTeam(result);
          setError(null);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load the organization team. Please try again.",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadTeam();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, organizationId, retry]);

  async function getSessionToken(): Promise<string> {
    const token = await getToken();
    if (!token) throw new Error("Your session has expired. Sign in again.");
    return token;
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setShareLink(null);
    setIsInviting(true);
    try {
      const token = await getSessionToken();
      const created = await inviteOrganizationMember(
        token,
        organizationId,
        email,
        role,
      );
      setShareLink(
        `${window.location.origin}/invitations/accept#token=${created.invitationToken}`,
      );
      setEmail("");
      const deliveryMessage =
        created.emailDeliveryStatus === "sent"
          ? "An invitation email was sent."
          : created.emailDeliveryStatus === "unavailable"
            ? "Email delivery is not configured; copy the link to share it."
            : "The invitation email could not be sent; copy the link to share it.";
      setNotice(
        `Invitation created for ${created.invitation.email}. ${deliveryMessage}`,
      );
      setTeam(await getOrganizationTeam(token, organizationId));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t create the invitation. Please try again.",
      );
    } finally {
      setIsInviting(false);
    }
  }

  async function copyInvitationLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setNotice("Invitation link copied. Share it with the invited person.");
    } catch {
      setError("The link couldn’t be copied. Check browser clipboard permissions.");
    }
  }

  async function changeMemberRole(
    userId: string,
    nextRole: ManagedMemberRole,
  ) {
    setError(null);
    setNotice(null);
    setBusyMemberId(userId);
    try {
      const token = await getSessionToken();
      await updateOrganizationMemberRole(
        token,
        organizationId,
        userId,
        nextRole,
      );
      setTeam(await getOrganizationTeam(token, organizationId));
      setNotice("Member role updated.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t update this member’s role.",
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(userId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this organization?`)) return;
    setError(null);
    setNotice(null);
    setBusyMemberId(userId);
    try {
      const token = await getSessionToken();
      await removeOrganizationMember(token, organizationId, userId);
      setTeam(await getOrganizationTeam(token, organizationId));
      setNotice(`${name} has been removed from the organization.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t remove this member.",
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function revokeInvitation(invitationId: string, inviteeEmail: string) {
    if (!window.confirm(`Revoke the invitation for ${inviteeEmail}?`)) return;
    setError(null);
    setNotice(null);
    setBusyInvitationId(invitationId);
    try {
      const token = await getSessionToken();
      await revokeOrganizationInvitation(token, organizationId, invitationId);
      setTeam(await getOrganizationTeam(token, organizationId));
      setNotice(`Invitation for ${inviteeEmail} revoked.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t revoke this invitation.",
      );
    } finally {
      setBusyInvitationId(null);
    }
  }

  if (isLoading) {
    return (
      <main className="team-page-shell" aria-live="polite">
        <p>Loading your organization team…</p>
      </main>
    );
  }

  return (
    <main className="team-page-shell">
      <Link className="project-back-link" href="/">
        ← Back to workspace
      </Link>
      {error && !team ? (
        <section className="project-details-card team-page-card" role="alert">
          <h1>We couldn’t load the team</h1>
          <p className="project-details-description">{error}</p>
          <button
            className="secondary-button"
            onClick={() => {
              setError(null);
              setIsLoading(true);
              setRetry((value) => value + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      ) : team ? (
        <>
          <header className="team-page-header">
            <div>
              <p className="onboarding-eyebrow">Organization workspace</p>
              <h1>{team.organization.name} team</h1>
              <p>Manage members, roles, and invitations for your organization.</p>
            </div>
            <span className="team-role-chip">{team.currentUserRole}</span>
          </header>

          {error && <p className="team-alert team-alert-error" role="alert">{error}</p>}
          {notice && <p className="team-alert team-alert-success" role="status">{notice}</p>}

          {team.canManage && (
            <section className="project-details-card team-section">
              <div className="team-section-heading">
                <div>
                  <h2>Invite a teammate</h2>
                  <p>Invite by email and choose their organization role.</p>
                </div>
              </div>
              <form className="team-invite-form" onSubmit={handleInvite}>
                <label className="form-field">
                  <span>Email address</span>
                  <input
                    autoComplete="email"
                    className="form-control"
                    maxLength={254}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="teammate@company.com"
                    required
                    type="email"
                    value={email}
                  />
                </label>
                <label className="form-field">
                  <span>Role</span>
                  <select
                    className="form-control"
                    onChange={(event) => {
                      if (isManagedMemberRole(event.target.value)) {
                        setRole(event.target.value);
                      }
                    }}
                    value={role}
                  >
                    {managedRoles.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" disabled={isInviting} type="submit">
                  {isInviting ? "Creating invitation…" : "Create invitation"}
                </button>
              </form>
              <p className="team-delivery-note">
                An invitation email is sent when Brevo is configured. You can also copy and share the one-time link. Invitations expire in 7 days.
              </p>
              {shareLink && (
                <div className="team-share-link">
                  <span role="status">Invitation link ready to share.</span>
                  <button
                    className="secondary-button"
                    onClick={() => void copyInvitationLink()}
                    type="button"
                  >
                    Copy invitation link
                  </button>
                </div>
              )}
            </section>
          )}

          {team.canManage && (
            <section className="project-details-card team-section">
              <div className="team-section-heading">
                <div>
                  <h2>Pending invitations</h2>
                  <p>Invitations expire after seven days.</p>
                </div>
                <span className="team-count">{team.invitations.length}</span>
              </div>
              {team.invitations.length === 0 ? (
                <div className="empty-state">
                  <strong>No pending invitations</strong>
                  <span>New invitations will appear here.</span>
                </div>
              ) : (
                <div className="team-list">
                  {team.invitations.map((invitation) => (
                    <article className="team-row" key={invitation.id}>
                      <div className="team-person">
                        <span className="team-avatar" aria-hidden="true">
                          {invitation.email.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{invitation.email}</strong>
                          <span>{invitation.role} · Expires {formatDate(invitation.expiresAt)}</span>
                        </div>
                      </div>
                      <button
                        className="text-button team-remove"
                        disabled={busyInvitationId === invitation.id}
                        onClick={() => void revokeInvitation(invitation.id, invitation.email)}
                        type="button"
                      >
                        {busyInvitationId === invitation.id ? "Revoking…" : "Revoke"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="project-details-card team-section">
            <div className="team-section-heading">
              <div>
                <h2>Members</h2>
                <p>People with access to this organization.</p>
              </div>
              <span className="team-count">{team.members.length}</span>
            </div>
            {team.members.length === 0 ? (
              <div className="empty-state">
                <strong>No members yet</strong>
                <span>Organization members will appear here.</span>
              </div>
            ) : (
              <div className="team-list">
                {team.members.map((member) => (
                  <article className="team-row" key={member.userId}>
                    <div className="team-person">
                      <span className="team-avatar" aria-hidden="true">
                        {member.name.trim().slice(0, 1).toUpperCase() || "?"}
                      </span>
                      <div>
                        <strong>{member.name}</strong>
                        <span>{member.email} · Joined {formatDate(member.joinedAt)}</span>
                      </div>
                    </div>
                    <div className="team-member-actions">
                      {member.role === "OWNER" || !team.canManage ? (
                        <span className={`team-role-chip ${member.role === "OWNER" ? "team-owner-chip" : ""}`}>
                          {member.role}
                        </span>
                      ) : (
                        <>
                          <label className="sr-only" htmlFor={`role-${member.userId}`}>
                            Role for {member.name}
                          </label>
                          <select
                            className="team-role-select"
                            disabled={busyMemberId === member.userId}
                            id={`role-${member.userId}`}
                            onChange={(event) => {
                              if (isManagedMemberRole(event.target.value)) {
                                void changeMemberRole(
                                  member.userId,
                                  event.target.value,
                                );
                              }
                            }}
                            value={member.role}
                          >
                            {managedRoles.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                          <button
                            aria-label={`Remove ${member.name}`}
                            className="text-button team-remove"
                            disabled={busyMemberId === member.userId}
                            onClick={() => void removeMember(member.userId, member.name)}
                            type="button"
                          >
                            {busyMemberId === member.userId ? "Saving…" : "Remove"}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <p className="workspace-footnote">
            Roles and membership are managed securely by NEXUS.
          </p>
        </>
      ) : (
        <section className="project-details-card team-page-card" role="alert">
          <h1>Organization unavailable</h1>
          <p className="project-details-description">
            This organization is unavailable or you don’t have access.
          </p>
        </section>
      )}
    </main>
  );
}
