"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  OrganizationProject,
  ProjectInput,
} from "@/lib/organizations";
import { Icon } from "./icons";

type ProjectDialogProps = {
  project?: OrganizationProject;
  onClose: () => void;
  onSave: (input: ProjectInput) => Promise<void>;
};

export function ProjectDialog({
  project,
  onClose,
  onSave,
}: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || Array.from(normalizedName).length > 100) {
      setError("Enter a project name between 1 and 100 characters.");
      return;
    }
    if (Array.from(description).length > 2000) {
      setError("Keep the description to 2000 characters or fewer.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave({
        name: normalizedName,
        description: description.trim() || null,
      });
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "We couldn’t save this project. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isSaving) onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <section
        aria-describedby="project-dialog-description"
        aria-labelledby="project-dialog-title"
        aria-modal="true"
        className="task-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <h2 id="project-dialog-title">
              {project ? "Edit project" : "Create a project"}
            </h2>
            <p id="project-dialog-description">
              {project
                ? "Update the name or description for this project."
                : "Give your team a clear place to organize its work."}
            </p>
          </div>
          <button
            aria-label="Close project dialog"
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
            <label htmlFor="project-name">Project name</label>
            <input
              autoFocus
              className="form-control"
              id="project-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Website refresh"
              required
              value={name}
            />
          </div>
          <div className="form-field">
            <label htmlFor="project-description">Description</label>
            <textarea
              className="form-control project-description-input"
              id="project-description"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project working toward?"
              rows={4}
              value={description}
            />
            <p className="form-help">Optional · up to 2000 characters</p>
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
              <Icon name="check" width={15} height={15} />
              {isSaving
                ? "Saving…"
                : project
                  ? "Save changes"
                  : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
