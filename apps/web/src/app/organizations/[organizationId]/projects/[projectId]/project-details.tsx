"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectDialog } from "@/components/dashboard/project-dialog";
import { FileAttachmentsPanel } from "@/components/dashboard/file-attachments-panel";
import { ProjectMembersPanel } from "@/components/dashboard/project-members-panel";
import { TaskManagement } from "@/components/dashboard/task-management";
import {
  archiveProject,
  getProject,
  restoreProject,
  updateProject,
  type OrganizationProject,
  type ProjectInput,
} from "@/lib/organizations";

type ProjectDetailsProps = {
  organizationId: string;
  projectId: string;
};

export default function ProjectDetails({
  organizationId,
  projectId,
}: ProjectDetailsProps) {
  const { getToken, isLoaded } = useAuth();
  const [loadedProject, setLoadedProject] = useState<{
    key: string;
    project: OrganizationProject | null;
    error: string | null;
  }>({ key: "", project: null, error: null });
  const [isEditing, setIsEditing] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestKey = `${organizationId}:${projectId}:${retry}`;
  const isLoading = !isLoaded || loadedProject.key !== requestKey;
  const project =
    loadedProject.key === requestKey ? loadedProject.project : null;
  const error = loadedProject.key === requestKey ? loadedProject.error : null;

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadProject() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Your session is unavailable. Sign in again to continue.");
        }
        const result = await getProject(token, organizationId, projectId);
        if (active) {
          setLoadedProject({ key: requestKey, project: result, error: null });
        }
      } catch (requestError) {
        if (active) {
          setLoadedProject({
            key: requestKey,
            project: null,
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load this project. Please try again.",
          });
        }
      }
    }

    void loadProject();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, organizationId, projectId, requestKey]);

  async function save(input: ProjectInput) {
    const token = await getToken();
    if (!token) throw new Error("Your session is unavailable. Sign in again.");
    const updated = await updateProject(
      token,
      organizationId,
      projectId,
      input,
    );
    setLoadedProject((current) => ({
      ...current,
      project: updated,
      error: null,
    }));
  }

  async function archive() {
    if (!project || !window.confirm(`Archive “${project.name}”? You can still view it later.`)) {
      return;
    }
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session is unavailable. Sign in again.");
      const archived = await archiveProject(token, organizationId, projectId);
      setLoadedProject((current) => ({
        ...current,
        project: archived,
        error: null,
      }));
    } catch (requestError) {
      setLoadedProject((current) => ({
        ...current,
        error:
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t archive this project. Please try again.",
      }));
    }
  }

  async function restore() {
    if (!project) return;
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session is unavailable. Sign in again.");
      const restored = await restoreProject(token, organizationId, projectId);
      setLoadedProject((current) => ({
        ...current,
        project: restored,
        error: null,
      }));
    } catch (requestError) {
      setLoadedProject((current) => ({
        ...current,
        error:
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t restore this project. Please try again.",
      }));
    }
  }

  return (
    <main className="project-details-page">
      <div className="project-details-shell">
        <Link className="project-back-link" href="/">
          ← Back to workspace
        </Link>

        {isLoading ? (
          <section className="project-details-card" aria-live="polite">
            Loading project…
          </section>
        ) : error && !project ? (
          <section className="project-details-card" role="alert">
            <h1>Project unavailable</h1>
            <p>{error}</p>
            <button
              className="primary-button"
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              Try again
            </button>
          </section>
        ) : project ? (
          <>
            <section className="project-details-card">
              <div className="project-details-top">
                <span className={`project-status ${project.status.toLowerCase()}`}>
                  {project.status === "ACTIVE" ? "Active" : "Archived"}
                </span>
                {project.canManage && project.status === "ACTIVE" && (
                  <div className="project-details-actions">
                    <button
                      className="secondary-button"
                      onClick={() => setIsEditing(true)}
                      type="button"
                    >
                      Edit project
                    </button>
                    <button
                      className="secondary-button project-archive-button"
                      onClick={archive}
                      type="button"
                    >
                      Archive
                    </button>
                  </div>
                )}
                {project.canManage && project.status === "ARCHIVED" && (
                  <div className="project-details-actions">
                    <button
                      className="secondary-button"
                      onClick={restore}
                      type="button"
                    >
                      Restore project
                    </button>
                  </div>
                )}
              </div>
              <h1>{project.name}</h1>
              <p className="project-details-description">
                {project.description || "No description has been added."}
              </p>
              <div className="project-details-metrics">
                <div>
                  <strong>{project.memberCount}</strong>
                  <span>{project.memberCount === 1 ? "Member" : "Members"}</span>
                </div>
                <div>
                  <strong>{project.taskCount}</strong>
                  <span>{project.taskCount === 1 ? "Task" : "Tasks"}</span>
                </div>
              </div>
              {error && <p className="project-details-error" role="alert">{error}</p>}
            </section>
            <ProjectMembersPanel
              canManage={project.canManage}
              organizationId={organizationId}
              projectId={projectId}
              projectStatus={project.status}
            />
            <FileAttachmentsPanel
              organizationId={organizationId}
              projectId={projectId}
            />
            <TaskManagement
              organizationId={organizationId}
              onTaskCreated={() => {
                setLoadedProject((current) =>
                  current.key === requestKey && current.project
                    ? {
                        ...current,
                        project: {
                          ...current.project,
                          taskCount: current.project.taskCount + 1,
                        },
                      }
                    : current,
                );
              }}
              projectId={projectId}
              projectName={project.name}
              projectStatus={project.status}
            />
          </>
        ) : null}
      </div>
      {isEditing && project && (
        <ProjectDialog
          onClose={() => setIsEditing(false)}
          onSave={save}
          project={project}
        />
      )}
    </main>
  );
}
