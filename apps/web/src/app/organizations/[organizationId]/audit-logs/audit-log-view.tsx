"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatRelativeTime } from "@/components/dashboard/dashboard-data";
import { Icon, type IconName } from "@/components/dashboard/icons";
import { useOrganizationWorkspace } from "@/components/dashboard/organization-shell";
import {
  formatAuditFieldValue,
  getAuditFieldChanges,
  getAuditResourceName,
} from "@/lib/audit-log-changes";
import {
  listOrganizationAuditLogs,
  type AuditLogAction,
  type AuditLogFilters,
  type AuditLogItem,
  type AuditLogTargetType,
} from "@/lib/audit-logs";
import {
  organizationDashboardPath,
  organizationMembersPath,
} from "@/lib/routes";

const actionLabels: Record<AuditLogAction, string> = {
  ORGANIZATION_MEMBER_ROLE_CHANGED: "changed an organization member's role",
  ORGANIZATION_MEMBER_REMOVED: "removed an organization member",
  INVITATION_CREATED: "created an invitation",
  INVITATION_REVOKED: "revoked an invitation",
  INVITATION_ACCEPTED: "accepted an invitation",
  INVITATION_RESENT: "resent an invitation",
  INVITATION_DECLINED: "declined an invitation",
  PROJECT_CREATED: "created a project",
  PROJECT_UPDATED: "updated a project",
  PROJECT_ARCHIVED: "archived a project",
  PROJECT_RESTORED: "restored a project",
  PROJECT_MEMBER_ADDED: "added a project member",
  PROJECT_MEMBER_REMOVED: "removed a project member",
  TASK_ASSIGNED: "changed task assignment",
  TASK_UPDATED: "updated a task",
  TASK_STATUS_CHANGED: "changed task status",
  TASK_BLOCKED: "blocked a task",
  TASK_UNBLOCKED: "resolved a task blocker",
  TASK_ARCHIVED: "archived a task",
  TASK_RESTORED: "restored a task",
  FILE_UPLOADED: "uploaded a file",
  FILE_REMOVED: "removed a file",
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
  { value: "FILE_ATTACHMENT", label: "File" },
];

type FilterOption = { id: string; label: string };

function getTargetTypeLabel(targetType: AuditLogTargetType): string {
  return (
    targetOptions.find((target) => target.value === targetType)?.label ??
    "Resource"
  );
}

function getEventIcon(targetType: AuditLogTargetType): IconName {
  if (targetType === "TASK") return "check-square";
  if (targetType === "PROJECT" || targetType === "PROJECT_MEMBER")
    return "briefcase";
  if (targetType === "FILE_ATTACHMENT") return "file";
  if (targetType === "INVITATION" || targetType === "ORGANIZATION_MEMBER")
    return "users";
  return "activity";
}

function getInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return initials || "NX";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const today = new Date();
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function toUtcStart(date: string): string | undefined {
  return date ? `${date}T00:00:00.000Z` : undefined;
}

function toUtcEnd(date: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined;
}

function mergeFilterOptions(
  current: FilterOption[],
  additions: FilterOption[],
): FilterOption[] {
  const options = new Map(current.map((option) => [option.id, option]));
  for (const option of additions) options.set(option.id, option);
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function resolveFilterId(
  query: string,
  options: FilterOption[],
): string | undefined {
  const normalized = query.trim().toLocaleLowerCase();
  const matchingOption = options.find(
    (option) => option.label.toLocaleLowerCase() === normalized,
  );
  if (matchingOption) return matchingOption.id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    query.trim(),
  )
    ? query.trim()
    : undefined;
}

function AuditEntry({ item }: { item: AuditLogItem }) {
  const changes = getAuditFieldChanges(item.before, item.after);
  const targetTypeLabel = getTargetTypeLabel(item.targetType);
  const resourceName =
    getAuditResourceName(item.before, item.after) ?? targetTypeLabel;

  return (
    <article className="audit-entry">
      <div className="audit-entry-identity" aria-hidden="true">
        <span className="audit-entry-avatar">
          {getInitials(item.actorName)}
        </span>
        <span className="audit-entry-icon">
          <Icon name={getEventIcon(item.targetType)} width={12} height={12} />
        </span>
      </div>
      <div className="audit-entry-content">
        <div className="audit-entry-heading">
          <div>
            <p className="audit-entry-summary">
              <strong>{item.actorName}</strong>{" "}
              <span>{actionLabels[item.action] ?? "performed an action"}</span>
            </p>
            <div className="audit-entry-target">
              <span className="audit-resource-type">{targetTypeLabel}</span>
              <strong>{resourceName}</strong>
            </div>
          </div>
          <div className="audit-entry-time">
            <time dateTime={item.createdAt}>
              {formatRelativeTime(item.createdAt)}
            </time>
            <span>{formatTimestamp(item.createdAt)}</span>
          </div>
        </div>
        {changes.length > 0 && (
          <details className="audit-entry-details">
            <summary>
              View {changes.length} recorded{" "}
              {changes.length === 1 ? "change" : "changes"}
            </summary>
            <div className="audit-change-list">
              {changes.map((change) => (
                <div className="audit-change-row" key={change.field}>
                  <span className="audit-change-field">{change.field}</span>
                  <span className="audit-change-values">
                    <span>
                      <small>Before</small>
                      {formatAuditFieldValue(change.before)}
                    </span>
                    <span className="audit-change-arrow" aria-hidden="true">
                      →
                    </span>
                    <span>
                      <small>After</small>
                      {formatAuditFieldValue(change.after)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
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
  const workspace = useOrganizationWorkspace();
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [targetType, setTargetType] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actorOptions, setActorOptions] = useState<FilterOption[]>([]);
  const [resourceOptions, setResourceOptions] = useState<FilterOption[]>([]);
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
        setActorOptions((current) =>
          mergeFilterOptions(
            current,
            result.items.map((item) => ({
              id: item.actorId,
              label: item.actorName,
            })),
          ),
        );
        setResourceOptions((current) =>
          mergeFilterOptions(
            current,
            result.items.flatMap((item) => {
              const name = getAuditResourceName(item.before, item.after);
              return name
                ? [
                    {
                      id: item.targetId,
                      label: `${name} · ${getTargetTypeLabel(item.targetType)}`,
                    },
                  ]
                : [];
            }),
          ),
        );
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn't load audit logs. Please try again.",
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
    const actorId = actorQuery.trim()
      ? resolveFilterId(actorQuery, actorOptions)
      : undefined;
    const targetId = resourceQuery.trim()
      ? resolveFilterId(resourceQuery, resourceOptions)
      : undefined;
    if (actorQuery.trim() && !actorId) {
      setFilterError("Choose an actor from the available name suggestions.");
      return;
    }
    if (resourceQuery.trim() && !targetId) {
      setFilterError("Choose a resource from the available name suggestions.");
      return;
    }
    if (fromDate && toDate && fromDate > toDate) {
      setFilterError("The from date must be before the through date.");
      return;
    }
    setFilterError(null);
    setFilters({
      page: 1,
      pageSize: 25,
      ...(action ? { action: action as AuditLogAction } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType: targetType as AuditLogTargetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(toUtcStart(fromDate) ? { from: toUtcStart(fromDate) } : {}),
      ...(toUtcEnd(toDate) ? { to: toUtcEnd(toDate) } : {}),
    });
  }

  function clearFilters() {
    setAction("");
    setActorQuery("");
    setTargetType("");
    setResourceQuery("");
    setFromDate("");
    setToDate("");
    setFilterError(null);
    setFilters({ page: 1, pageSize: 25 });
  }

  const activeFilterCount = [
    filters.action,
    filters.actorId,
    filters.targetType,
    filters.targetId,
    filters.from,
    filters.to,
  ].filter(Boolean).length;
  const todayCount = items.filter((item) => isToday(item.createdAt)).length;
  const actorCount = new Set(items.map((item) => item.actorId)).size;
  const categoryCount = new Set(items.map((item) => item.targetType)).size;

  return (
    <main className="team-page-shell audit-page-shell">
      <nav className="audit-breadcrumbs" aria-label="Breadcrumb">
        <Link href={organizationDashboardPath(organizationId)}>Home</Link>
        <Icon name="chevron-right" width={13} height={13} />
        <span>{workspace?.name ?? "Organization"}</span>
        <Icon name="chevron-right" width={13} height={13} />
        <span aria-current="page">Audit logs</span>
      </nav>

      <header className="audit-page-header">
        <div>
          <span className="audit-page-kicker">
            <Icon name="activity" width={14} height={14} />
            {workspace?.name ?? "Current organization"}
          </span>
          <h1>Audit logs</h1>
          <p>
            Review security-sensitive changes across members, projects, tasks,
            and files.
          </p>
        </div>
        <div className="audit-header-actions">
          <span className="audit-access-chip">Owner &amp; Admin access</span>
          <Link
            className="secondary-button"
            href={organizationMembersPath(organizationId)}
          >
            <Icon name="users" width={15} height={15} />
            Manage team
          </Link>
        </div>
      </header>

      {!error && !isLoading && items.length > 0 && (
        <section
          className="audit-overview"
          aria-label="Current audit page overview"
        >
          <article>
            <span>Events on page</span>
            <strong>{items.length}</strong>
            <small>Page {page}</small>
          </article>
          <article>
            <span>Today</span>
            <strong>{todayCount}</strong>
            <small>On this page</small>
          </article>
          <article>
            <span>Active actors</span>
            <strong>{actorCount}</strong>
            <small>On this page</small>
          </article>
          <article>
            <span>Resource types</span>
            <strong>{categoryCount}</strong>
            <small>{formatRelativeTime(items[0].createdAt)}</small>
          </article>
        </section>
      )}

      <form className="audit-filters" onSubmit={applyFilters}>
        <div className="audit-panel-heading">
          <div className="audit-panel-title">
            <span className="audit-panel-icon">
              <Icon name="filter" width={16} height={16} />
            </span>
            <div>
              <h2>Filter activity</h2>
              <p>
                Narrow events within {workspace?.name ?? "this organization"}.
              </p>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <span className="audit-filter-count">
              {activeFilterCount} active
            </span>
          )}
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
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Actor</span>
            <input
              className="form-control"
              list="audit-actor-options"
              onChange={(event) => setActorQuery(event.target.value)}
              placeholder="Search by member name"
              value={actorQuery}
            />
            <datalist id="audit-actor-options">
              {actorOptions.map((option) => (
                <option key={option.id} value={option.label} />
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>Resource type</span>
            <select
              className="form-control"
              onChange={(event) => setTargetType(event.target.value)}
              value={targetType}
            >
              <option value="">All resource types</option>
              {targetOptions.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Resource</span>
            <input
              className="form-control"
              list="audit-resource-options"
              onChange={(event) => setResourceQuery(event.target.value)}
              placeholder="Search by resource name"
              value={resourceQuery}
            />
            <datalist id="audit-resource-options">
              {resourceOptions.map((option) => (
                <option key={option.id} value={option.label} />
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>From date</span>
            <input
              className="form-control"
              onChange={(event) => setFromDate(event.target.value)}
              type="date"
              value={fromDate}
            />
          </label>
          <label className="form-field">
            <span>Through date</span>
            <input
              className="form-control"
              onChange={(event) => setToDate(event.target.value)}
              type="date"
              value={toDate}
            />
          </label>
        </div>
        {filterError && (
          <p className="audit-filter-error" role="alert">
            {filterError}
          </p>
        )}
        <div className="audit-filter-actions">
          <button
            className="secondary-button"
            onClick={clearFilters}
            type="button"
          >
            Clear
          </button>
          <button className="primary-button" disabled={isLoading} type="submit">
            <Icon name="filter" width={15} height={15} />
            Apply filters
          </button>
        </div>
      </form>

      {error && (
        <section className="audit-state audit-state-error" role="alert">
          <span className="audit-state-icon">
            <Icon name="info" width={21} height={21} />
          </span>
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
        <section
          className="audit-feed audit-loading"
          aria-label="Loading audit logs"
          aria-live="polite"
        >
          <div className="audit-panel-heading">
            <span className="ui-skeleton audit-heading-skeleton" />
          </div>
          {[0, 1, 2].map((item) => (
            <div className="audit-loading-row" key={item}>
              <span className="ui-skeleton audit-avatar-skeleton" />
              <span>
                <span className="ui-skeleton audit-line-skeleton" />
                <span className="ui-skeleton audit-line-skeleton audit-line-skeleton-short" />
              </span>
            </div>
          ))}
        </section>
      )}
      {!error && !isLoading && items.length === 0 && (
        <section className="audit-state">
          <span className="audit-state-icon">
            <Icon name="activity" width={21} height={21} />
          </span>
          <h2>
            {activeFilterCount > 0
              ? "No matching activity"
              : "No activity recorded yet"}
          </h2>
          <p>
            {activeFilterCount > 0
              ? "Adjust or clear the filters to review more organization events."
              : "Security and workflow events will appear here as your organization works."}
          </p>
          {activeFilterCount > 0 && (
            <button
              className="secondary-button"
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          )}
        </section>
      )}
      {!error && !isLoading && items.length > 0 && (
        <section
          className="audit-feed"
          aria-label="Organization audit activity"
        >
          <div className="audit-panel-heading">
            <div className="audit-panel-title">
              <span className="audit-panel-icon">
                <Icon name="activity" width={16} height={16} />
              </span>
              <div>
                <h2>Activity timeline</h2>
                <p>Newest events appear first.</p>
              </div>
            </div>
            <span className="audit-page-label">Page {page}</span>
          </div>
          <div className="audit-entry-list">
            {items.map((item) => (
              <AuditEntry item={item} key={item.id} />
            ))}
          </div>
          <nav className="audit-pagination" aria-label="Audit log pages">
            <button
              className="secondary-button"
              disabled={page <= 1 || isLoading}
              onClick={() =>
                setFilters((current) => ({ ...current, page: page - 1 }))
              }
              type="button"
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary-button"
              disabled={!hasMore || isLoading}
              onClick={() =>
                setFilters((current) => ({ ...current, page: page + 1 }))
              }
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
