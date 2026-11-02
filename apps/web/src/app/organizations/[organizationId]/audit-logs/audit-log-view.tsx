"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  listOrganizationAuditLogs,
  type AuditLogAction,
  type AuditLogFilters,
  type AuditLogItem,
  type AuditLogTargetType,
} from "@/lib/audit-logs";
import {
  formatAuditFieldValue,
  getAuditFieldChanges,
} from "@/lib/audit-log-changes";

const actionLabels: Record<AuditLogAction, string> = {
  ORGANIZATION_MEMBER_ROLE_CHANGED: "changed an organization member’s role",
  ORGANIZATION_MEMBER_REMOVED: "removed an organization member",
  INVITATION_CREATED: "created an invitation",
  INVITATION_REVOKED: "revoked an invitation",
  INVITATION_ACCEPTED: "accepted an invitation",
  PROJECT_CREATED: "created a project",
  PROJECT_UPDATED: "updated a project",
  PROJECT_ARCHIVED: "archived a project",
  PROJECT_RESTORED: "restored a project",
  PROJECT_MEMBER_ADDED: "added a project member",
  PROJECT_MEMBER_REMOVED: "removed a project member",
  TASK_ASSIGNED: "changed task assignment",
  TASK_UPDATED: "updated a task",
  TASK_STATUS_CHANGED: "changed task status",
  TASK_ARCHIVED: "archived a task",
  TASK_RESTORED: "restored a task",
};

const actionOptions = Object.entries(actionLabels) as [
  AuditLogAction,
  string,
][];
const targetOptions: { value: AuditLogTargetType; label: string }[] = [
  { value: "ORGANIZATION_MEMBER", label: "Organization member" },
  { value: "INVITATION", label: "Invitation" },
  { value: "PROJECT", label: "Project" },
  { value: "PROJECT_MEMBER", label: "Project member" },
  { value: "TASK", label: "Task" },
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toUtcStart(date: string): string | undefined {
  return date ? `${date}T00:00:00.000Z` : undefined;
}

function toUtcEnd(date: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined;
}

function AuditEntry({ item }: { item: AuditLogItem }) {
  const hasChanges = item.before !== null || item.after !== null;
  const changes = getAuditFieldChanges(item.before, item.after);
  const targetLabel =
    targetOptions.find((target) => target.value === item.targetType)?.label ??
    item.targetType;
  return (
    <article className="audit-entry">
      <div className="audit-entry-marker" aria-hidden="true" />
      <div className="audit-entry-content">
        <div className="audit-entry-heading">
          <div>
            <p className="audit-entry-summary">
              <strong>{item.actorName}</strong>{" "}
              {actionLabels[item.action] ?? "performed an action"}
            </p>
            <p className="audit-entry-target">
              {targetLabel} <code>{item.targetId}</code>
            </p>
          </div>
          <time dateTime={item.createdAt}>{formatTimestamp(item.createdAt)}</time>
        </div>
        {hasChanges && (
          <details className="audit-entry-details">
            <summary>View recorded changes</summary>
            {changes.length > 0 ? (
              <div className="audit-change-list">
                {changes.map((change) => (
                  <div className="audit-change-row" key={change.field}>
                    <span className="audit-change-field">{change.field}</span>
                    <span className="audit-change-values">
                      <span>{formatAuditFieldValue(change.before)}</span>
                      <span className="audit-change-arrow" aria-hidden="true">
                        →
                      </span>
                      <span>{formatAuditFieldValue(change.after)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="audit-change-empty">
                No field differences were recorded.
              </p>
            )}
          </details>
        )}
      </div>
    </article>
  );
}

export default function AuditLogView({
  organizationId,
}: {
  organizationId: string;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    pageSize: 25,
  });

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadLogs() {
      setIsLoading(true);
      setError(null);
      if (!isSignedIn) {
        setError("Sign in to view organization audit logs.");
        setIsLoading(false);
        return;
      }

      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const result = await listOrganizationAuditLogs(
          token,
          organizationId,
          filters,
        );
        if (!active) return;
        setItems(result.items);
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load audit logs. Please try again.",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadLogs();
    return () => {
      active = false;
    };
  }, [filters, getToken, isLoaded, isSignedIn, organizationId]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      page: 1,
      pageSize: 25,
      ...(action ? { action: action as AuditLogAction } : {}),
      ...(actorId.trim() ? { actorId: actorId.trim() } : {}),
      ...(targetType ? { targetType: targetType as AuditLogTargetType } : {}),
      ...(targetId.trim() ? { targetId: targetId.trim() } : {}),
      ...(toUtcStart(fromDate) ? { from: toUtcStart(fromDate) } : {}),
      ...(toUtcEnd(toDate) ? { to: toUtcEnd(toDate) } : {}),
    });
  }

  function clearFilters() {
    setAction("");
    setActorId("");
    setTargetType("");
    setTargetId("");
    setFromDate("");
    setToDate("");
    setFilters({ page: 1, pageSize: 25 });
  }

  return (
    <main className="team-page-shell audit-page-shell">
      <Link
        className="project-back-link"
        href={`/organizations/${encodeURIComponent(organizationId)}/members`}
      >
        ← Back to organization team
      </Link>
      <header className="team-page-header">
        <div>
          <p className="onboarding-eyebrow">Organization workspace</p>
          <h1>Audit logs</h1>
          <p>Review important membership, invitation, project, and task changes.</p>
        </div>
        <span className="team-role-chip">Owner &amp; Admin</span>
      </header>

      <form className="project-details-card audit-filters" onSubmit={applyFilters}>
        <div className="team-section-heading">
          <div>
            <h2>Filter activity</h2>
            <p>Filters apply only within this organization.</p>
          </div>
          <button className="text-button" onClick={clearFilters} type="button">
            Clear filters
          </button>
        </div>
        <div className="audit-filter-grid">
          <label className="form-field">
            <span>Action</span>
            <select
              className="form-control"
              onChange={(event) => setAction(event.target.value)}
              value={action}
            >
              <option value="">All actions</option>
              {actionOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Actor user ID</span>
            <input
              className="form-control"
              onChange={(event) => setActorId(event.target.value)}
              placeholder="Filter by actor UUID"
              value={actorId}
            />
          </label>
          <label className="form-field">
            <span>Target type</span>
            <select
              className="form-control"
              onChange={(event) => setTargetType(event.target.value)}
              value={targetType}
            >
              <option value="">All targets</option>
              {targetOptions.map((target) => (
                <option key={target.value} value={target.value}>{target.label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Target ID</span>
            <input
              className="form-control"
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="Filter by target UUID"
              value={targetId}
            />
          </label>
          <label className="form-field">
            <span>From</span>
            <input
              className="form-control"
              onChange={(event) => setFromDate(event.target.value)}
              type="date"
              value={fromDate}
            />
          </label>
          <label className="form-field">
            <span>Through</span>
            <input
              className="form-control"
              onChange={(event) => setToDate(event.target.value)}
              type="date"
              value={toDate}
            />
          </label>
        </div>
        <div className="audit-filter-actions">
          <button className="primary-button" type="submit">Apply filters</button>
        </div>
      </form>

      {error && (
        <section className="project-details-card audit-state" role="alert">
          <h2>Audit logs unavailable</h2>
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setFilters((current) => ({ ...current }))}
            type="button"
          >
            Try again
          </button>
        </section>
      )}
      {!error && isLoading && (
        <section className="project-details-card audit-state" aria-live="polite">
          Loading audit logs…
        </section>
      )}
      {!error && !isLoading && items.length === 0 && (
        <section className="project-details-card audit-state">
          <h2>No activity found</h2>
          <p>Try changing the filters or check back after organization activity.</p>
        </section>
      )}
      {!error && !isLoading && items.length > 0 && (
        <section className="project-details-card audit-feed" aria-label="Organization audit activity">
          <div className="team-section-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Newest events appear first.</p>
            </div>
            <span className="team-count">Page {page}</span>
          </div>
          <div className="audit-entry-list">
            {items.map((item) => <AuditEntry item={item} key={item.id} />)}
          </div>
          <nav className="audit-pagination" aria-label="Audit log pages">
            <button
              className="secondary-button"
              disabled={page <= 1 || isLoading}
              onClick={() => setFilters((current) => ({ ...current, page: page - 1 }))}
              type="button"
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary-button"
              disabled={!hasMore || isLoading}
              onClick={() => setFilters((current) => ({ ...current, page: page + 1 }))}
              type="button"
            >
              Next
            </button>
          </nav>
        </section>
      )}
    </main>
  );
}
