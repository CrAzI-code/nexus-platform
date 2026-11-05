"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState, type FormEvent } from "react";
import {
  listTaskProjectMembers,
  type TaskProjectMember,
} from "@/lib/tasks";
import {
  createWorkflowAutomation,
  deleteWorkflowAutomation,
  listWorkflowAutomations,
  setWorkflowAutomationEnabled,
  updateWorkflowAutomation,
  type WorkflowAction,
  type WorkflowAutomation,
  type WorkflowAutomationInput,
  type WorkflowTrigger,
} from "@/lib/workflow-automations";

type WorkflowAutomationsPanelProps = {
  organizationId: string;
  projectId: string;
  projectStatus: "ACTIVE" | "ARCHIVED";
};

const triggerOptions: { value: WorkflowTrigger; label: string }[] = [
  { value: "TASK_CREATED", label: "Task created" },
  { value: "TASK_STATUS_CHANGED", label: "Task status changed" },
  { value: "TASK_ASSIGNED", label: "Task assigned or reassigned" },
  { value: "TASK_DUE_DATE_APPROACHING", label: "Task due tomorrow" },
  { value: "TASK_OVERDUE", label: "Task becomes overdue" },
  { value: "TASK_BLOCKER_REPORTED", label: "Task blocker reported" },
  { value: "TASK_BLOCKER_RESOLVED", label: "Task blocker resolved" },
];

const defaultDraft: WorkflowAutomationInput = {
  name: "",
  trigger: "TASK_CREATED",
  conditionPriority: null,
  conditionStatus: null,
  conditionAssigneeId: null,
  action: "SEND_NOTIFICATION",
  actionValue: "",
  actionAssigneeId: null,
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function actionSummary(
  rule: WorkflowAutomation,
  members: TaskProjectMember[],
): string {
  if (rule.action === "SEND_NOTIFICATION") {
    return `Notify task participants: ${rule.actionValue ?? ""}`;
  }
  if (rule.action === "CHANGE_STATUS") {
    return `Change status to ${(rule.actionValue ?? "").replaceAll("_", " ")}`;
  }
  const member = members.find(
    (candidate) => candidate.id === rule.actionAssigneeId,
  );
  return member
    ? `Assign task to ${member.name}`
    : "Assign task to a selected project member";
}

export function WorkflowAutomationsPanel({
  organizationId,
  projectId,
  projectStatus,
}: WorkflowAutomationsPanelProps) {
  const { getToken, isLoaded } = useAuth();
  const [rules, setRules] = useState<WorkflowAutomation[]>([]);
  const [members, setMembers] = useState<TaskProjectMember[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [reload, setReload] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowAutomationInput>(defaultDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKey = `${organizationId}:${projectId}:${reload}`;
  const isLoading = !isLoaded || loadedKey !== requestKey;
  const isEditable = projectStatus === "ACTIVE";

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function load() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const [loadedRules, loadedMembers] = await Promise.all([
          listWorkflowAutomations(token, organizationId, projectId),
          listTaskProjectMembers(token, organizationId, projectId),
        ]);
        if (!active) return;
        setRules(loadedRules);
        setMembers(loadedMembers.members);
        setError(null);
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load project automations.",
          );
        }
      } finally {
        if (active) setLoadedKey(requestKey);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, organizationId, projectId, requestKey]);

  function startEditing(rule?: WorkflowAutomation) {
    setEditingId(rule?.id ?? null);
    setDraft(
      rule
        ? {
            name: rule.name,
            trigger: rule.trigger,
            conditionPriority: rule.conditionPriority,
            conditionStatus: rule.conditionStatus,
            conditionAssigneeId: rule.conditionAssigneeId,
            action: rule.action,
            actionValue: rule.actionValue,
            actionAssigneeId: rule.actionAssigneeId,
          }
        : {
            ...defaultDraft,
            actionValue: "A task you follow needs your attention.",
          },
    );
    setError(null);
    setNotice(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setDraft(defaultDraft);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const updated = editingId
        ? await updateWorkflowAutomation(
            token,
            organizationId,
            projectId,
            editingId,
            draft,
          )
        : await createWorkflowAutomation(
            token,
            organizationId,
            projectId,
            draft,
          );
      setRules((current) =>
        editingId
          ? current.map((rule) => (rule.id === editingId ? updated : rule))
          : [updated, ...current],
      );
      setNotice(editingId ? "Automation updated." : "Automation created.");
      cancelEditing();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t save this automation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: WorkflowAutomation) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const updated = await setWorkflowAutomationEnabled(
        token,
        organizationId,
        projectId,
        rule.id,
        !rule.enabled,
      );
      setRules((current) =>
        current.map((currentRule) =>
          currentRule.id === updated.id ? updated : currentRule,
        ),
      );
      setNotice(updated.enabled ? "Automation enabled." : "Automation paused.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t update this automation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: WorkflowAutomation) {
    if (!window.confirm(`Delete “${rule.name}”? Its execution history will remain.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session has expired. Sign in again.");
      await deleteWorkflowAutomation(
        token,
        organizationId,
        projectId,
        rule.id,
      );
      setRules((current) => current.filter((item) => item.id !== rule.id));
      if (editingId === rule.id) cancelEditing();
      setNotice("Automation deleted. Its execution history was retained.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t delete this automation.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateAction(action: WorkflowAction) {
    setDraft((current) => ({
      ...current,
      action,
      actionValue:
        action === "SEND_NOTIFICATION"
          ? "A task you follow needs your attention."
          : action === "CHANGE_STATUS"
            ? "IN_PROGRESS"
            : null,
      actionAssigneeId:
        action === "ASSIGN_MEMBER" ? members[0]?.id ?? null : null,
    }));
  }

  return (
    <section className="project-details-card workflow-automations-card">
      <div className="task-section-heading">
        <div>
          <h2>Workflow automations</h2>
          <p>Let routine task events trigger safe, project-scoped actions.</p>
        </div>
        {isEditable && (
          <button
            className="primary-button"
            disabled={busy || editingId !== null}
            onClick={() => startEditing()}
            type="button"
          >
            Create automation
          </button>
        )}
      </div>

      {projectStatus === "ARCHIVED" && (
        <p className="task-inline-note">
          Automations in archived projects are read-only and won’t run.
        </p>
      )}
      {error && <p className="project-details-error" role="alert">{error}</p>}
      {notice && <p className="task-success" role="status">{notice}</p>}

      {isLoading ? (
        <p aria-live="polite" className="project-members-state">
          Loading automations…
        </p>
      ) : loadedKey === requestKey && error && rules.length === 0 ? (
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
          type="button"
        >
          Try again
        </button>
      ) : null}

      {editingId !== null || (isEditable && !editingId && draft !== defaultDraft) ? (
        <form className="workflow-automation-form" onSubmit={(event) => void save(event)}>
          <div className="workflow-form-grid">
            <label>
              Automation name
              <input
                className="form-control"
                maxLength={120}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={draft.name}
              />
            </label>
            <label>
              When this happens
              <select
                className="form-control"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    trigger: event.target.value as WorkflowTrigger,
                  }))
                }
                value={draft.trigger}
              >
                {triggerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Only if priority is
              <select
                className="form-control"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    conditionPriority:
                      (event.target.value as WorkflowAutomationInput["conditionPriority"]) ||
                      null,
                  }))
                }
                value={draft.conditionPriority ?? ""}
              >
                <option value="">Any priority</option>
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <label>
              Only if status is
              <select
                className="form-control"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    conditionStatus:
                      (event.target.value as WorkflowAutomationInput["conditionStatus"]) ||
                      null,
                  }))
                }
                value={draft.conditionStatus ?? ""}
              >
                <option value="">Any status</option>
                {["TODO", "IN_PROGRESS", "BLOCKED", "DONE"].map((status) => (
                  <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
            <label>
              Only if assigned to
              <select
                className="form-control"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    conditionAssigneeId: event.target.value || null,
                  }))
                }
                value={draft.conditionAssigneeId ?? ""}
              >
                <option value="">Any assignee</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
            <label>
              Then do this
              <select
                className="form-control"
                onChange={(event) => updateAction(event.target.value as WorkflowAction)}
                value={draft.action}
              >
                <option value="SEND_NOTIFICATION">Notify relevant members</option>
                <option value="CHANGE_STATUS">Change task status</option>
                <option value="ASSIGN_MEMBER">Assign to a project member</option>
              </select>
            </label>
            {draft.action === "SEND_NOTIFICATION" ? (
              <label className="workflow-form-wide">
                Notification message
                <textarea
                  className="form-control"
                  maxLength={500}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      actionValue: event.target.value,
                    }))
                  }
                  required
                  rows={2}
                  value={draft.actionValue ?? ""}
                />
              </label>
            ) : draft.action === "CHANGE_STATUS" ? (
              <label>
                New task status
                <select
                  className="form-control"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      actionValue: event.target.value,
                    }))
                  }
                  value={draft.actionValue ?? "IN_PROGRESS"}
                >
                  {["TODO", "IN_PROGRESS", "DONE"].map((status) => (
                    <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Assign task to
                <select
                  className="form-control"
                  disabled={members.length === 0}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      actionAssigneeId: event.target.value || null,
                    }))
                  }
                  required
                  value={draft.actionAssigneeId ?? ""}
                >
                  <option value="">Select a member</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="workflow-form-actions">
            <button
              className="primary-button"
              disabled={
                busy ||
                !draft.name.trim() ||
                (draft.action === "ASSIGN_MEMBER" && !draft.actionAssigneeId)
              }
              type="submit"
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Create rule"}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={cancelEditing}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {!isLoading && !error && rules.length === 0 && editingId === null && (
        <div className="settings-empty-note">
          <p>No automations yet. Create a rule to automate a common task workflow.</p>
        </div>
      )}

      <div className="workflow-automation-list">
        {rules.map((rule) => (
          <article className="workflow-automation-item" key={rule.id}>
            <div className="workflow-automation-top">
              <div>
                <div className="workflow-automation-title">
                  <h3>{rule.name}</h3>
                  <span className={rule.enabled ? "workflow-status is-enabled" : "workflow-status"}>
                    {rule.enabled ? "Enabled" : "Paused"}
                  </span>
                </div>
                <p>
                  When: {triggerOptions.find((item) => item.value === rule.trigger)?.label}
                  {rule.conditionPriority ? ` · Priority ${rule.conditionPriority}` : ""}
                  {rule.conditionStatus ? ` · Status ${rule.conditionStatus.replaceAll("_", " ")}` : ""}
                  {rule.conditionAssigneeId
                    ? ` · Assignee ${members.find((member) => member.id === rule.conditionAssigneeId)?.name ?? "former member"}`
                    : ""}
                </p>
                <p className="workflow-action-summary">{actionSummary(rule, members)}</p>
              </div>
              {isEditable && (
                <div className="workflow-automation-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => startEditing(rule)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void toggle(rule)}
                    type="button"
                  >
                    {rule.enabled ? "Pause" : "Enable"}
                  </button>
                  <button
                    className="secondary-button workflow-delete-button"
                    disabled={busy}
                    onClick={() => void remove(rule)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div className="workflow-history">
              <h4>Recent activity</h4>
              {rule.executions.length ? (
                <ul>
                  {rule.executions.map((execution) => (
                    <li key={execution.id}>
                      <span className={`workflow-execution-status is-${execution.status.toLowerCase()}`}>
                        {execution.status.toLowerCase()}
                      </span>
                      <span className="workflow-execution-description">
                        <strong>{execution.taskTitle}</strong>
                        <span>
                          {execution.reason ??
                            execution.error ??
                            "Automation is being processed."}
                        </span>
                      </span>
                      <time dateTime={execution.triggeredAt}>
                        {formatTime(execution.triggeredAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No executions yet. Scheduled and activity triggers are checked every 30 seconds.</p>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
