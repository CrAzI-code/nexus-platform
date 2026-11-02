"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Project, TaskPriority } from "./dashboard-data";
import { Icon } from "./icons";

type NewTaskDetails = {
  title: string;
  projectId: string;
  priority: TaskPriority;
  dueDate: string;
};

type NewTaskDialogProps = {
  projects: Project[];
  onClose: () => void;
  onCreate: (task: NewTaskDetails) => void;
};

export function NewTaskDialog({ projects, onClose, onCreate }: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (trimmedTitle.length < 3) {
      setError("Enter a task title with at least 3 characters.");
      return;
    }

    if (!projects.some((project) => project.id === projectId)) {
      setError("Choose a project in this workspace.");
      return;
    }

    onCreate({ title: trimmedTitle, projectId, priority, dueDate });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <section
        aria-describedby="new-task-description"
        aria-labelledby="new-task-title"
        aria-modal="true"
        className="task-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <h2 id="new-task-title">Create a task</h2>
            <p id="new-task-description">Add a clear next step to a project.</p>
          </div>
          <button
            aria-label="Close new task dialog"
            className="modal-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" width={17} height={17} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="task-title">Task name</label>
            <input
              autoFocus
              className="form-control"
              id="task-title"
              maxLength={100}
              onChange={(event) => {
                setTitle(event.target.value);
                setError("");
              }}
              placeholder="What needs to get done?"
              required
              value={title}
            />
            <p className="form-help">Use a short, action-oriented title.</p>
          </div>
          <div className="form-field">
            <label htmlFor="task-project">Project</label>
            <select
              className="form-control"
              id="task-project"
              onChange={(event) => setProjectId(event.target.value)}
              required
              value={projectId}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="task-priority">Priority</label>
            <select
              className="form-control"
              id="task-priority"
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
            <label htmlFor="task-due-date">Due date</label>
            <input
              className="form-control"
              id="task-due-date"
              onChange={(event) => setDueDate(event.target.value)}
              type="date"
              value={dueDate}
            />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Icon name="plus" width={15} height={15} />
              Create task
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
