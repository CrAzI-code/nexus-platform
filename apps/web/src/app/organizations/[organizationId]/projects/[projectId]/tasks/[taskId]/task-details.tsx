"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/dashboard/icons";
import { FileAttachmentsPanel } from "@/components/dashboard/file-attachments-panel";
import {
  addProjectTaskComment,
  archiveProjectTask,
  assignProjectTask,
  changeProjectTaskStatus,
  getProjectTask,
  listTaskProjectMembers,
  restoreProjectTask,
  updateProjectTask,
  type TaskDetails,
  type TaskMembers,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";

type TaskDetailsProps = {
  organizationId: string;
  projectId: string;
  taskId: string;
};

const statusLabels: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const priorityLabels: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function displayAttributionName(name: string): string {
  return name.trim() || "Former project member (account unavailable)";
}

export default function TaskDetailsPage({
  organizationId,
  projectId,
  taskId,
}: TaskDetailsProps) {
  const { getToken, isLoaded } = useAuth();
  const [loaded, setLoaded] = useState<{
    key: string;
    task: TaskDetails | null;
    error: string | null;
  }>({ key: "", task: null, error: null });
  const [loadedMembers, setLoadedMembers] = useState<{
    key: string;
    members: TaskMembers | null;
    error: string | null;
  }>({ key: "", members: null, error: null });
  const [retry, setRetry] = useState(0);
  const [membersRetry, setMembersRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [blockerReason, setBlockerReason] = useState("");
  const requestKey = `${organizationId}:${projectId}:${taskId}:${retry}`;
  const isLoading = !isLoaded || loaded.key !== requestKey;
  const task = loaded.key === requestKey ? loaded.task : null;
  const loadError = loaded.key === requestKey ? loaded.error : null;
  const membersRequestKey = `${requestKey}:${membersRetry}`;
  const members =
    loadedMembers.key === membersRequestKey ? loadedMembers.members : null;
  const membersError =
    loadedMembers.key === membersRequestKey ? loadedMembers.error : null;
  const isMembersLoading =
    !isLoaded ||
    (task?.canAssignOthers === true &&
      loadedMembers.key !== membersRequestKey);
  const canChange = Boolean(
    task && task.archivedAt === null && task.projectStatus === "ACTIVE",
  );

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadTask() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session is unavailable. Sign in again.");
        const result = await getProjectTask(
          token,
          organizationId,
          projectId,
          taskId,
        );
        if (active) {
          setLoaded({ key: requestKey, task: result, error: null });
          setStatus(result.status);
        }
      } catch (requestError) {
        if (active) {
          setLoaded({
            key: requestKey,
            task: null,
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load this task. Please try again.",
          });
        }
      }
    }

    void loadTask();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, organizationId, projectId, requestKey, taskId]);

  useEffect(() => {
    if (!isLoaded || loaded.key !== requestKey || !loaded.task?.canAssignOthers) {
      return;
    }
    let active = true;

    async function loadProjectMembers() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session is unavailable. Sign in again.");
        const projectMembers = await listTaskProjectMembers(
          token,
          organizationId,
          projectId,
        );
        if (active) {
          setLoadedMembers({
            key: membersRequestKey,
            members: projectMembers,
            error: null,
          });
        }
      } catch (requestError) {
        if (active) {
          setLoadedMembers({
            key: membersRequestKey,
            members: null,
            error:
              requestError instanceof Error &&
              requestError.name === "TimeoutError"
                ? "Loading assignees timed out. Check your connection and try again."
                : requestError instanceof Error
                ? requestError.message
                : "We couldn’t load assignees. Please try again.",
          });
        }
      }
    }

    void loadProjectMembers();
    return () => {
      active = false;
    };
  }, [
    getToken,
    isLoaded,
    loaded.key,
    loaded.task?.canAssignOthers,
    membersRequestKey,
    organizationId,
    projectId,
    requestKey,
  ]);

  async function performAction(
    action: string,
    operation: (token: string) => Promise<TaskDetails>,
    successMessage: string,
  ): Promise<boolean> {
    setActionError(null);
    setNotice(null);
    setBusyAction(action);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session is unavailable. Sign in again.");
      const updated = await operation(token);
      setLoaded((current) =>
        current.key === requestKey ? { ...current, task: updated } : current,
      );
      setStatus(updated.status);
      setNotice(successMessage);
      return true;
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t update this task. Please try again.",
      );
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function saveDetails(input: {
    title: string;
    description: string | null;
    priority: TaskPriority;
    dueAt: string | null;
  }) {
    const saved = await performAction(
      "save",
      (token) =>
        updateProjectTask(token, organizationId, projectId, taskId, input),
      "Task details saved.",
    );
    if (saved) setIsEditing(false);
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = comment.trim();
    if (!body) {
      setActionError("Write a comment before posting.");
      return;
    }
    void performAction(
      "comment",
      (token) =>
        addProjectTaskComment(token, organizationId, projectId, taskId, body),
      "Comment added.",
    ).then((saved) => {
      if (saved) setComment("");
    });
  }

  function changeTaskStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "BLOCKED" && !blockerReason.trim()) {
      setActionError("Add a short reason so your team knows what is blocking this.");
      return;
    }
    void performAction(
      "status",
      (token) =>
        changeProjectTaskStatus(
          token,
          organizationId,
          projectId,
          taskId,
          status,
          status === "BLOCKED" ? blockerReason.trim() : undefined,
        ),
      "Task status updated.",
    ).then((saved) => {
      if (saved) setBlockerReason("");
    });
  }

  function changeAssignee(assigneeId: string | null) {
    void performAction(
      "assignee",
      (token) =>
        assignProjectTask(
          token,
          organizationId,
          projectId,
          taskId,
          assigneeId,
        ),
      "Task assignment updated.",
    );
  }

  function archiveOrRestore() {
    if (!task) return;
    const isArchived = Boolean(task.archivedAt);
    if (
      isArchived ||
      window.confirm(`Archive “${task.title}”? You can restore it later.`)
    ) {
      void performAction(
        isArchived ? "restore" : "archive",
        (token) =>
          isArchived
            ? restoreProjectTask(token, organizationId, projectId, taskId)
            : archiveProjectTask(token, organizationId, projectId, taskId),
        isArchived ? "Task restored." : "Task archived.",
      );
    }
  }

  return (
    <main className="project-details-page">
      <div className="task-details-shell">
        <Link
          className="project-back-link"
          href={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`}
        >
          ← Back to {task?.projectName ?? "project"}
        </Link>

        {isLoading ? (
          <section className="project-details-card" aria-live="polite">
            Loading task…
          </section>
        ) : loadError || !task ? (
          <section className="project-details-card" role="alert">
            <h1>Task unavailable</h1>
            <p>{loadError ?? "This task is no longer available."}</p>
            <button
              className="primary-button"
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              Try again
            </button>
          </section>
        ) : (
          <>
            <section className="project-details-card task-detail-card">
              <div className="project-details-top">
                <span
                  className={`task-status ${task.status.toLowerCase().replace("_", "-")}`}
                >
                  {statusLabels[task.status]}
                </span>
                <div className="project-details-actions">
                  {task.canManage && canChange && (
                    <button
                      className="secondary-button"
                      onClick={() => setIsEditing((value) => !value)}
                      type="button"
                    >
                      {isEditing ? "Cancel edit" : "Edit task"}
                    </button>
                  )}
                  {task.canManage && task.projectStatus === "ACTIVE" && (
                    <button
                      className={`secondary-button${task.archivedAt ? "" : " project-archive-button"}`}
                      disabled={busyAction !== null}
                      onClick={archiveOrRestore}
                      type="button"
                    >
                      {task.archivedAt ? "Restore task" : "Archive task"}
                    </button>
                  )}
                </div>
              </div>
              <h1>{task.title}</h1>
              <p className="task-project-name">{task.projectName}</p>
              <p className="project-details-description">
                {task.description || "No description has been added."}
              </p>

              {isEditing && (
                <TaskEditForm
                  task={task}
                  isSaving={busyAction === "save"}
                  onCancel={() => setIsEditing(false)}
                  onSave={saveDetails}
                />
              )}

              <div className="task-metadata">
                <div>
                  <span>Priority</span>
                  <strong className={`priority-badge ${task.priority.toLowerCase()}`}>
                    {priorityLabels[task.priority]}
                  </strong>
                </div>
                <div>
                  <span>Due date</span>
                  <strong>
                    {task.dueAt
                      ? new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeZone: "UTC",
                        }).format(new Date(task.dueAt))
                      : "No due date"}
                  </strong>
                </div>
                <div>
                  <span>Created by</span>
                  <strong>{task.creator.name}</strong>
                </div>
              </div>

              <div className="task-control-grid">
                <form className="task-control-card" onSubmit={changeTaskStatus}>
                  <label htmlFor="task-status-control">Status</label>
                  <select
                    className="form-control"
                    disabled={!canChange || busyAction !== null}
                    id="task-status-control"
                    onChange={(event) => setStatus(event.target.value as TaskStatus)}
                    value={status}
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {status === "BLOCKED" && canChange && (
                    <textarea
                      aria-label="Blocker details"
                      className="form-control"
                      maxLength={2000}
                      onChange={(event) => setBlockerReason(event.target.value)}
                      placeholder="What is blocking this task?"
                      rows={2}
                      value={blockerReason}
                    />
                  )}
                  <button
                    className="secondary-button"
                    disabled={!canChange || busyAction !== null}
                    type="submit"
                  >
                    Update status
                  </button>
                </form>

                <div className="task-control-card">
                  <span className="task-control-label">Assignee</span>
                  {task.canAssignOthers && members ? (
                    <select
                      className="form-control"
                      aria-label="Task assignee"
                      disabled={!canChange || busyAction !== null}
                      onChange={(event) =>
                        changeAssignee(event.target.value || null)
                      }
                      value={task.assignee?.id ?? ""}
                    >
                      <option value="">Unassigned</option>
                      {members.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}{member.isCurrentUser ? " (you)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : task.canAssignOthers ? (
                    <div className="task-assignee-loading" aria-live="polite">
                      {membersError ? (
                        <>
                          <p className="project-details-error" role="alert">
                            {membersError}
                          </p>
                          <button
                            className="secondary-button"
                            onClick={() =>
                              setMembersRetry((value) => value + 1)
                            }
                            type="button"
                          >
                            Retry assignee list
                          </button>
                        </>
                      ) : (
                        <p className="task-assignee-value">
                          {isMembersLoading
                            ? "Loading assignees…"
                            : task.assignee?.name ?? "Unassigned"}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="task-assignee-value">
                      {task.assignee?.name ?? "Unassigned"}
                    </p>
                  )}
                </div>
              </div>

              {(actionError || notice) && (
                <p
                  className={actionError ? "project-details-error" : "task-success"}
                  role={actionError ? "alert" : "status"}
                >
                  {actionError ?? notice}
                </p>
              )}
            </section>

            <FileAttachmentsPanel
              organizationId={organizationId}
              projectId={projectId}
              taskId={taskId}
            />

            <section className="project-details-card task-comments-card">
              <div className="task-section-heading">
                <div>
                  <h2>Comments</h2>
                  <p>{task.commentCount} {task.commentCount === 1 ? "comment" : "comments"}</p>
                </div>
              </div>
              <form className="task-comment-form" onSubmit={submitComment}>
                <label className="sr-only" htmlFor="task-comment">Add a comment</label>
                <textarea
                  className="form-control"
                  disabled={!canChange || busyAction !== null}
                  id="task-comment"
                  maxLength={5000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Share an update with the project…"
                  rows={3}
                  value={comment}
                />
                <button
                  className="primary-button"
                  disabled={!canChange || busyAction !== null || !comment.trim()}
                  type="submit"
                >
                  {busyAction === "comment" ? "Posting…" : "Post comment"}
                </button>
              </form>
              {task.comments.length > 0 ? (
                <div className="task-comment-list">
                  {task.comments.map((item) => (
                    <article className="task-comment" key={item.id}>
                      <div>
                        <strong>{displayAttributionName(item.authorName)}</strong>
                        <time>{formatDate(item.createdAt)}</time>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="task-empty-note">No comments yet.</p>
              )}
            </section>

            <section className="project-details-card task-history-card">
              <div className="task-section-heading">
                <div>
                  <h2>Activity history</h2>
                  <p>Changes and updates are retained with this task.</p>
                </div>
              </div>
              {task.activity.length > 0 ? (
                <ol className="task-history-list">
                  {task.activity.map((item) => (
                    <li key={item.id}>
                      <span className="task-history-dot" />
                      <div>
                        <p>
                          <strong>{displayAttributionName(item.actorName)}</strong>{" "}
                          {item.message}
                        </p>
                        <time>{formatDate(item.createdAt)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="task-empty-note">No activity recorded yet.</p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function TaskEditForm({
  task,
  isSaving,
  onCancel,
  onSave,
}: {
  task: TaskDetails;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (input: {
    title: string;
    description: string | null;
    priority: TaskPriority;
    dueAt: string | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [dueAt, setDueAt] = useState(task.dueAt?.slice(0, 10) ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || Array.from(normalizedTitle).length > 200) {
      setError("Enter a task title between 1 and 200 characters.");
      return;
    }
    if (Array.from(description).length > 5000) {
      setError("Keep the description to 5000 characters or fewer.");
      return;
    }
    setError(null);
    await onSave({
      title: normalizedTitle,
      description: description.trim() || null,
      priority,
      dueAt: dueAt || null,
    });
  }

  return (
    <form className="task-edit-form" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="edit-task-title">Title</label>
        <input
          className="form-control"
          id="edit-task-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
      </div>
      <div className="form-field">
        <label htmlFor="edit-task-description">Description</label>
        <textarea
          className="form-control"
          id="edit-task-description"
          maxLength={5000}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          value={description}
        />
      </div>
      <div className="task-form-grid">
        <div className="form-field">
          <label htmlFor="edit-task-priority">Priority</label>
          <select
            className="form-control"
            id="edit-task-priority"
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            value={priority}
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="edit-task-due">Due date</label>
          <input
            className="form-control"
            id="edit-task-due"
            onChange={(event) => setDueAt(event.target.value)}
            type="date"
            value={dueAt}
          />
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button
          className="secondary-button"
          disabled={isSaving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button className="primary-button" disabled={isSaving} type="submit">
          <Icon name="check" width={15} height={15} />
          {isSaving ? "Saving…" : "Save task"}
        </button>
      </div>
    </form>
  );
}
