"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  type ProjectMembers,
} from "@/lib/organizations";

type ProjectMembersPanelProps = {
  organizationId: string;
  projectId: string;
  projectStatus: "ACTIVE" | "ARCHIVED";
  canManage: boolean;
};

export function ProjectMembersPanel({
  organizationId,
  projectId,
  projectStatus,
  canManage,
}: ProjectMembersPanelProps) {
  const { getToken, isLoaded } = useAuth();
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    value: ProjectMembers | null;
    error: string | null;
  }>({ key: "", value: null, error: null });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKey = `${organizationId}:${projectId}:${reload}`;
  const isLoading = !isLoaded || loaded.key !== requestKey;
  const result = loaded.key === requestKey ? loaded.value : null;
  const loadError = loaded.key === requestKey ? loaded.error : null;
  const canEdit = canManage && result?.canManage === true && projectStatus === "ACTIVE";

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadMembers() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Your session is unavailable. Sign in again to continue.");
        }
        const members = await listProjectMembers(
          token,
          organizationId,
          projectId,
        );
        if (active) {
          setLoaded({ key: requestKey, value: members, error: null });
          setSelectedUserId((current) =>
            members.availableMembers.some((member) => member.userId === current)
              ? current
              : members.availableMembers[0]?.userId ?? "",
          );
        }
      } catch (requestError) {
        if (active) {
          setLoaded({
            key: requestKey,
            value: null,
            error:
              requestError instanceof Error &&
              requestError.name === "TimeoutError"
                ? "Loading project members timed out. Check your connection and try again."
                : requestError instanceof Error
                ? requestError.message
                : "We couldn’t load project members. Please try again.",
          });
        }
      }
    }

    void loadMembers();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, organizationId, projectId, requestKey]);

  async function addSelectedMember() {
    if (!selectedUserId) return;
    setBusyUserId(selectedUserId);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session is unavailable. Sign in again.");
      const added = await addProjectMember(
        token,
        organizationId,
        projectId,
        selectedUserId,
      );
      setNotice(`${added.name} was added to the project.`);
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t add this member. Please try again.",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(userId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this project?`)) return;
    setBusyUserId(userId);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session is unavailable. Sign in again.");
      await removeProjectMember(token, organizationId, projectId, userId);
      setNotice(`${name} was removed from the project.`);
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t remove this member. Please try again.",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="project-details-card project-members-card">
      <div className="task-section-heading">
        <div>
          <h2>Project members</h2>
          <p>Only active project members can be assigned to tasks.</p>
        </div>
      </div>

      {canManage && projectStatus === "ARCHIVED" && (
        <p className="task-inline-note">Archived projects can’t change their membership.</p>
      )}
      {error && <p className="project-details-error" role="alert">{error}</p>}
      {notice && <p className="task-success" role="status">{notice}</p>}

      {isLoading ? (
        <p aria-live="polite" className="project-members-state">Loading project members…</p>
      ) : loadError ? (
        <div className="project-members-state">
          <p className="project-details-error" role="alert">{loadError}</p>
          <button
            className="secondary-button"
            onClick={() => setReload((value) => value + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : result ? (
        <>
          {canEdit && (
            <form
              className="project-members-add"
              onSubmit={(event) => {
                event.preventDefault();
                void addSelectedMember();
              }}
            >
              <label className="sr-only" htmlFor="project-member-select">
                Organization member to add
              </label>
              <select
                className="form-control"
                disabled={!result.availableMembers.length || busyUserId !== null}
                id="project-member-select"
                onChange={(event) => setSelectedUserId(event.target.value)}
                value={selectedUserId}
              >
                {result.availableMembers.length ? (
                  result.availableMembers.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name} · {member.email}
                    </option>
                  ))
                ) : (
                  <option value="">All organization members are already added</option>
                )}
              </select>
              <button
                className="primary-button"
                disabled={!selectedUserId || busyUserId !== null}
                type="submit"
              >
                {busyUserId === selectedUserId ? "Adding…" : "Add member"}
              </button>
            </form>
          )}

          {result.members.length ? (
            <ul className="project-members-list">
              {result.members.map((member) => (
                <li className="project-member-row" key={member.userId}>
                  <div className="project-member-person">
                    <span aria-hidden="true" className="team-avatar">
                      {member.name.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <span className="project-member-identity">
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </span>
                  </div>
                  <div className="project-member-actions">
                    <span className="project-member-role">{member.role}</span>
                    {canEdit && (
                      <button
                        aria-label={`Remove ${member.name} from project`}
                        className="team-remove"
                        disabled={busyUserId !== null}
                        onClick={() => void removeMember(member.userId, member.name)}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="project-members-state">No active members have been added to this project.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
