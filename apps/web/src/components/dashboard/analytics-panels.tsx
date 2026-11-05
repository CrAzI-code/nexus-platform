"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getOrganizationAnalytics,
  getProjectAnalytics,
  type AnalyticsDays,
  type AnalyticsStatus,
  type AnalyticsWorkload,
  type OrganizationAnalytics,
  type ProjectAnalytics,
} from "@/lib/analytics";

const ranges: { value: AnalyticsDays; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const statuses: { value: AnalyticsStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All open work" },
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Completed" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Metric({ label, value, note, tone = "" }: {
  label: string;
  value: number | string;
  note?: string;
  tone?: string;
}) {
  return (
    <article className={`analytics-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </article>
  );
}

function WorkloadList({ entries }: { entries: AnalyticsWorkload[] }) {
  if (entries.length === 0) {
    return <p className="analytics-empty">No active project members to report.</p>;
  }
  const maximum = Math.max(1, ...entries.map((entry) => entry.total));
  return (
    <div className="analytics-workload-list">
      {entries.map((entry) => (
        <div className="analytics-workload-row" key={entry.userId ?? "unassigned"}>
          <div className="analytics-workload-label">
            <strong>{entry.name}</strong>
            <span>{entry.total} {entry.total === 1 ? "task" : "tasks"}</span>
          </div>
          <div
            aria-label={`${entry.name}: ${entry.todo} to do, ${entry.inProgress} in progress, ${entry.blocked} blocked, ${entry.done} completed`}
            className="analytics-workload-track"
            role="img"
          >
            <span className="todo" style={{ width: `${(entry.todo / maximum) * 100}%` }} />
            <span className="in-progress" style={{ width: `${(entry.inProgress / maximum) * 100}%` }} />
            <span className="blocked" style={{ width: `${(entry.blocked / maximum) * 100}%` }} />
            <span className="done" style={{ width: `${(entry.done / maximum) * 100}%` }} />
          </div>
        </div>
      ))}
      <div aria-label="Workload status legend" className="analytics-legend">
        <span><i className="todo" />To do</span>
        <span><i className="in-progress" />In progress</span>
        <span><i className="blocked" />Blocked</span>
        {entries.some((entry) => entry.done > 0) && <span><i className="done" />Completed</span>}
      </div>
    </div>
  );
}

function RangeSelect({
  value,
  onChange,
}: {
  value: AnalyticsDays;
  onChange: (value: AnalyticsDays) => void;
}) {
  return (
    <label className="analytics-filter">
      Activity range
      <select
        className="filter-select"
        onChange={(event) => onChange(Number(event.target.value) as AnalyticsDays)}
        value={value}
      >
        {ranges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
      </select>
    </label>
  );
}

export function OrganizationAnalyticsPanel({ organizationId }: { organizationId: string }) {
  const { getToken, isLoaded } = useAuth();
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [projectId, setProjectId] = useState("");
  const [retry, setRetry] = useState(0);
  const [report, setReport] = useState<{
    key: string;
    data: OrganizationAnalytics | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const requestKey = `${organizationId}:${days}:${projectId}:${retry}`;
  const isLoading = !isLoaded || report.key !== requestKey;

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    async function load() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const data = await getOrganizationAnalytics(token, organizationId, {
          days,
          ...(projectId ? { projectId } : {}),
        });
        if (active) setReport({ key: requestKey, data, error: null });
      } catch (requestError) {
        if (active) {
          setReport({
            key: requestKey,
            data: null,
            error: requestError instanceof Error ? requestError.message : "We couldn’t load analytics.",
          });
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [days, getToken, isLoaded, organizationId, projectId, requestKey]);

  const data = report.key === requestKey ? report.data : null;
  const error = report.key === requestKey ? report.error : null;
  return (
    <section aria-busy={isLoading} aria-labelledby="organization-analytics-title" className="analytics-panel">
      <div className="analytics-heading">
        <div>
          <p className="analytics-eyebrow">Organization reporting</p>
          <h2 id="organization-analytics-title">Analytics</h2>
          <p>Current totals across projects you can access. Activity covers the selected period.</p>
        </div>
        <div className="analytics-controls">
          <label className="analytics-filter">
            Project
            <select
              className="filter-select"
              onChange={(event) => setProjectId(event.target.value)}
              value={projectId}
            >
              <option value="">All visible projects</option>
              {(data?.projectOptions ?? []).map((project) => (
                <option key={project.id} value={project.id}>{project.name}{project.status === "ARCHIVED" ? " (archived)" : ""}</option>
              ))}
            </select>
          </label>
          <RangeSelect onChange={setDays} value={days} />
        </div>
      </div>

      {isLoading ? (
        <p aria-live="polite" className="analytics-state">Loading organization analytics…</p>
      ) : error ? (
        <div className="analytics-state" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRetry((value) => value + 1)} type="button">Try again</button>
        </div>
      ) : data ? (
        <>
          <div className="analytics-metric-grid">
            <Metric label="Projects" value={data.projects.total} note={`${data.projects.active} active`} />
            <Metric label="Tasks" value={data.tasks.total} note="Unarchived tasks" />
            <Metric label="Completed" value={data.tasks.completed} note={`${data.tasks.total ? Math.round((data.tasks.completed / data.tasks.total) * 100) : 0}% of tasks`} tone="success" />
            <Metric label="In progress" value={data.tasks.inProgress} tone="progress" />
            <Metric label="Overdue" value={data.tasks.overdue} tone="danger" />
            <Metric label="Blocked" value={data.tasks.blocked} tone="warning" />
          </div>

          <div className="analytics-grid">
            <section className="analytics-block" aria-labelledby="organization-project-progress-title">
              <div className="analytics-block-heading">
                <div><h3 id="organization-project-progress-title">Project completion</h3><p>Completed tasks ÷ unarchived tasks</p></div>
              </div>
              {data.projectCompletion.length ? (
                <div className="analytics-project-list">
                  {data.projectCompletion.map((project) => (
                    <Link
                      className="analytics-project-row"
                      href={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.id)}`}
                      key={project.id}
                    >
                      <span className="analytics-project-copy"><strong>{project.name}</strong><small>{project.completedTasks} of {project.totalTasks} tasks</small></span>
                      <span aria-label={`${project.completionPercentage}% complete`} className="analytics-progress-track"><i style={{ width: `${project.completionPercentage}%` }} /></span>
                      <strong className="analytics-percentage">{project.completionPercentage}%</strong>
                    </Link>
                  ))}
                </div>
              ) : <p className="analytics-empty">No projects match this selection.</p>}
            </section>

            <section className="analytics-block" aria-labelledby="organization-workload-title">
              <div className="analytics-block-heading">
                <div><h3 id="organization-workload-title">Team workload</h3><p>Open tasks in active projects by assignee</p></div>
              </div>
              <WorkloadList entries={data.workload} />
            </section>
          </div>

          <section className="analytics-block analytics-activity-block" aria-labelledby="organization-activity-title">
            <div className="analytics-block-heading">
              <div><h3 id="organization-activity-title">Recent project activity</h3><p>Latest task events in the selected period</p></div>
            </div>
            {data.recentActivity.length ? (
              <ul className="analytics-activity-list">
                {data.recentActivity.map((activity) => (
                  <li key={activity.id}>
                    <span className="analytics-activity-mark" aria-hidden="true" />
                    <div><p><strong>{activity.actorName}</strong> · {activity.message}</p><small>{activity.projectName} / {activity.taskTitle}</small></div>
                    <time dateTime={activity.createdAt}>{formatDate(activity.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="analytics-empty">No project activity in this period.</p>}
          </section>
        </>
      ) : null}
    </section>
  );
}

export function ProjectAnalyticsPanel({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { getToken, isLoaded } = useAuth();
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [status, setStatus] = useState<AnalyticsStatus | "ALL">("ALL");
  const [retry, setRetry] = useState(0);
  const [report, setReport] = useState<{
    key: string;
    data: ProjectAnalytics | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const requestKey = `${organizationId}:${projectId}:${days}:${status}:${retry}`;
  const isLoading = !isLoaded || report.key !== requestKey;

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    async function load() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        const data = await getProjectAnalytics(token, organizationId, projectId, {
          days,
          ...(status !== "ALL" ? { status } : {}),
        });
        if (active) setReport({ key: requestKey, data, error: null });
      } catch (requestError) {
        if (active) {
          setReport({
            key: requestKey,
            data: null,
            error: requestError instanceof Error ? requestError.message : "We couldn’t load project analytics.",
          });
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [days, getToken, isLoaded, organizationId, projectId, requestKey, status]);

  const data = report.key === requestKey ? report.data : null;
  const error = report.key === requestKey ? report.error : null;
  return (
    <section aria-busy={isLoading} aria-labelledby="project-analytics-title" className="analytics-panel project-analytics-panel">
      <div className="analytics-heading">
        <div>
          <p className="analytics-eyebrow">Project reporting</p>
          <h2 id="project-analytics-title">Project analytics</h2>
          <p>Current task and blocker state with activity across the selected period.</p>
        </div>
        <div className="analytics-controls">
          <label className="analytics-filter">
            Workload status
            <select className="filter-select" onChange={(event) => setStatus(event.target.value as AnalyticsStatus | "ALL")} value={status}>
              {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <RangeSelect onChange={setDays} value={days} />
        </div>
      </div>

      {isLoading ? (
        <p aria-live="polite" className="analytics-state">Loading project analytics…</p>
      ) : error ? (
        <div className="analytics-state" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRetry((value) => value + 1)} type="button">Try again</button>
        </div>
      ) : data ? (
        <>
          <div className="analytics-metric-grid project-analytics-metrics">
            <Metric label="Tasks" value={data.tasks.total} />
            <Metric label="Completed" value={data.tasks.completed} note={`${data.tasks.completionPercentage}% complete`} tone="success" />
            <Metric label="In progress" value={data.tasks.inProgress} tone="progress" />
            <Metric label="Overdue" value={data.tasks.overdue} tone="danger" />
            <Metric label="Blocked" value={data.tasks.blocked} tone="warning" />
            <Metric label="Open blockers" value={data.blockers.unresolved} note={`${data.blockers.resolved} resolved`} />
          </div>

          <div className="analytics-grid">
            <section className="analytics-block" aria-labelledby="project-activity-title">
              <div className="analytics-block-heading">
                <div><h3 id="project-activity-title">Task activity</h3><p>Daily activity over the last {days} days</p></div>
              </div>
              <ActivityChart days={data.activityByDay} />
            </section>
            <section className="analytics-block" aria-labelledby="project-workload-title">
              <div className="analytics-block-heading">
                <div><h3 id="project-workload-title">Member workload</h3><p>{status === "ALL" ? "Open assigned work" : `${statuses.find((item) => item.value === status)?.label} tasks`}</p></div>
              </div>
              <WorkloadList entries={data.workload} />
            </section>
          </div>

          <div className="analytics-grid analytics-work-lists">
            <section className="analytics-block" aria-labelledby="recent-completions-title">
              <div className="analytics-block-heading"><div><h3 id="recent-completions-title">Recently completed</h3><p>Completion events in the selected period</p></div></div>
              {data.recentlyCompleted.length ? (
                <ul className="analytics-work-list">
                  {data.recentlyCompleted.map((task) => <li key={task.id}><strong>{task.title}</strong><time dateTime={task.completedAt}>{formatDate(task.completedAt)}</time></li>)}
                </ul>
              ) : <p className="analytics-empty">No tasks completed in this period.</p>}
            </section>
            <section className="analytics-block" aria-labelledby="overdue-work-title">
              <div className="analytics-block-heading"><div><h3 id="overdue-work-title">Overdue work</h3><p>Uncompleted tasks past their due date</p></div></div>
              {data.overdueWork.length ? (
                <ul className="analytics-work-list">
                  {data.overdueWork.map((task) => <li key={task.id}><span><strong>{task.title}</strong><small>{task.assigneeName ?? "Unassigned"} · {task.status.replaceAll("_", " ")}</small></span><time dateTime={task.dueAt}>{formatDate(task.dueAt)}</time></li>)}
                </ul>
              ) : <p className="analytics-empty">No overdue tasks.</p>}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ActivityChart({ days }: { days: { date: string; count: number }[] }) {
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const slot = 720 / Math.max(days.length, 1);
  const width = Math.max(2, slot * 0.62);
  return (
    <div className="analytics-chart-wrap">
      <svg aria-label="Task activity by day" className="analytics-chart" role="img" viewBox="0 0 720 150" preserveAspectRatio="none">
        <title>Task activity by day</title>
        <line x1="0" x2="720" y1="126" y2="126" />
        {days.map((day, index) => {
          const height = day.count === 0 ? 2 : Math.max(4, (day.count / maximum) * 108);
          return (
            <rect
              height={height}
              key={day.date}
              rx="2"
              width={width}
              x={index * slot + (slot - width) / 2}
              y={126 - height}
            >
              <title>{`${day.date}: ${day.count} ${day.count === 1 ? "event" : "events"}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="analytics-chart-labels">
        <time>{days.length ? formatDate(days[0].date) : ""}</time>
        <time>{days.length ? formatDate(days[days.length - 1].date) : ""}</time>
      </div>
    </div>
  );
}