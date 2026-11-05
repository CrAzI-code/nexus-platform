"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import {
  createProjectTask,
  listProjectTasks,
  type ProjectTask,
  type TaskInput,
  type TaskPriority,
} from "@/lib/tasks";

type TaskManagementProps = {
  organizationId: string;
  projectId: string;
  projectName: string;
  projectStatus: "ACTIVE" | "ARCHIVED";
  onTaskCreated: () => void;
};

const priorityLabels: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

function formatTaskDate(value: string | null): string {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function isTaskOverdue(task: ProjectTask): boolean {
  return Boolean(
    task.dueAt &&
      task.status !== "DONE" &&
      !task.archivedAt &&
      task.dueAt.slice(0, 10) < new Date().toISOString().slice(0, 10),
  );
}

export function TaskManagement({
  organizationId,
  projectId,
  projectName,
  projectStatus,
  onTaskCreated,
}: TaskManagementProps) {
  const { getToken, isLoaded } = useAuth();
  const [load, setLoad] = useState<{
    key: string;
    tasks: ProjectTask[];
    error: string | null;
  }>({ key: "", tasks: [], error: null });
  const [retry, setRetry] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKey = `${organizationId}:${projectId}:${retry}`;
  const isLoading = !isLoaded || load.key !== requestKey;
  const tasks = load.key === requestKey ? load.tasks : [];
  const error = load.key === requestKey ? load.error : null;

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadTasks() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session is unavailable. Sign in again.");
        const result = await listProjectTasks(token, organizationId, projectId);
        if (active) setLoad({ key: requestKey, tasks: result, error: null });
      } catch (requestError) {
        if (active) {
          setLoad({
            key: requestKey,
            tasks: [],
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load this project’s tasks.",
          });
        }
      }
    }

    void loadTasks();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, organizationId, projectId, requestKey]);

  async function createTask(input: TaskInput) {
    const token = await getToken();
    if (!token) throw new Error("Your session is unavailable. Sign in again.");
    const created = await createProjectTask(
      token,
      organizationId,
      projectId,
      input,
    );
    setLoad((current) => ({
      ...current,
      tasks: [created, ...current.tasks],
    }));
    onTaskCreated();
    setNotice("Task created.");
  }

  return (
    <section className="project-tasks-panel" aria-labelledby="project-tasks-title">
      <div className="project-tasks-heading">
        <div>
          <h2 id="project-tasks-title">Tasks</h2>
          <p>Keep the next steps for {projectName} moving forward.</p>
        </div>
        {projectStatus === "ACTIVE" && (
          <button
            className="primary-button"
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            <Icon name="plus" width={15} height={15} />
            New task
          </button>
        )}
      </div>

      {projectStatus === "ARCHIVED" && (
        <p className="task-inline-note">This project is archived. Tasks are read-only.</p>
      )}
      {notice && <p className="task-success" role="status">{notice}</p>}
      {isLoading ? (
        <p className="task-loading" aria-live="polite">Loading tasks…</p>
      ) : error ? (
        <div className="task-list-state" role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="task-list-state">
          <strong>No tasks yet</strong>
          <p>Create a task to give the team a clear next step.</p>
        </div>
      ) : (
        <div className="project-task-list">
          {tasks.map((task) => (
            <Link
              className={`project-task-row${task.archivedAt ? " archived" : ""}`}
              href={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}`}
              key={task.id}
            >
              <span className={`task-status ${task.status.toLowerCase().replace("_", "-")}`}>
                {task.status.replace("_", " ")}
              </span>
              <span className="project-task-copy">
                <strong>{task.title}</strong>
                <span>
                  {task.assignee ? `Assigned to ${task.assignee.name}` : "Unassigned"}
                  {task.archivedAt ? " · Archived" : ""}
                </span>
                {task.activeBlocker && (
                  <span className="project-task-blocker">
                    Blocked: {task.activeBlocker.reason}
                  </span>
                )}
              </span>
              <span className={`priority-badge ${task.priority.toLowerCase()}`}>
                {priorityLabels[task.priority]}
              </span>
              <time className={`task-due${isTaskOverdue(task) ? " overdue" : ""}`}>
                {isTaskOverdue(task) ? "Overdue" : formatTaskDate(task.dueAt)}
              </time>
            </Link>
          ))}
        </div>
      )}

      {isCreateOpen && (
        <CreateTaskDialog
          onClose={() => setIsCreateOpen(false)}
          onCreate={createTask}
        />
      )}
    </section>
  );
}

function CreateTaskDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: TaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    setIsSaving(true);
    try {
      await onCreate({
        title: normalizedTitle,
        description: description.trim() || null,
        priority,
        dueAt: dueAt || null,
      });
      onClose();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "We couldn’t create this task. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        aria-labelledby="create-task-title"
        aria-modal="true"
        className="task-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <h2 id="create-task-title">Create a task</h2>
            <p>Add a clear next step to this project.</p>
          </div>
          <button
            aria-label="Close create task dialog"
            className="modal-close"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" width={17} height={17} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="create-task-name">Task title</label>
            <input
              autoFocus
              className="form-control"
              id="create-task-name"
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </div>
          <div className="form-field">
            <label htmlFor="create-task-description">Description</label>
            <textarea
              className="form-control project-description-input"
              id="create-task-description"
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </div>
          <div className="task-form-grid">
            <div className="form-field">
              <label htmlFor="create-task-priority">Priority</label>
              <select
                className="form-control"
                id="create-task-priority"
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                value={priority}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="create-task-due">Due date</label>
              <input
                className="form-control"
                id="create-task-due"
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
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Creating…" : "Create task"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
