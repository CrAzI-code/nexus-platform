"use client";

import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Task, Workspace } from "./dashboard-data";
import { DashboardSidebar, type DashboardSection } from "./dashboard-sidebar";
import {
  ActivitySection,
  ProjectsSection,
  QuickActionsSection,
  TasksSection,
} from "./dashboard-sections";
import { OrganizationAnalyticsPanel } from "./analytics-panels";
import { Icon } from "./icons";
import { ProjectDialog } from "./project-dialog";
import { NotificationCenter } from "./notification-center";
import {
  archiveProject,
  createProject,
  listProjects,
  restoreProject,
  updateProject,
  type OrganizationProject,
  type ProjectInput,
} from "@/lib/organizations";
import { listProjectTasks, TaskApiError } from "@/lib/tasks";
import { listOrganizationAuditLogs, type AuditLogItem } from "@/lib/audit-logs";
import { organizationDashboardPath } from "@/lib/routes";

const EMPTY_PROJECTS: OrganizationProject[] = [];

export default function Dashboard({
  workspaces,
  initialWorkspaceId,
}: {
  workspaces: Workspace[];
  initialWorkspaceId?: string;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const initialWorkspace = workspaces.find((item) => item.id === initialWorkspaceId)
    ?? workspaces[0];
  const [workspaceId, setWorkspaceId] = useState(initialWorkspace?.id ?? "");
  const [activeSection, setActiveSection] = useState<DashboardSection>("home");
  const [search, setSearch] = useState("");
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [projectLoad, setProjectLoad] = useState<{
    organizationId: string;
    projects: OrganizationProject[];
    error: string | null;
  }>({ organizationId: "", projects: [], error: null });
  const [projectDialog, setProjectDialog] = useState<
    "create" | OrganizationProject | null
  >(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [projectRetry, setProjectRetry] = useState(0);
  const [taskRetry, setTaskRetry] = useState(0);
  const [taskLoad, setTaskLoad] = useState<{
    organizationId: string;
    tasks: Task[];
    error: string | null;
  }>({ organizationId: "", tasks: [], error: null });
  const [activityLoad, setActivityLoad] = useState<{
    organizationId: string;
    items: AuditLogItem[];
    error: string | null;
  }>({ organizationId: "", items: [], error: null });
  const [activityRetry, setActivityRetry] = useState(0);

  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const isProjectsLoading = projectLoad.organizationId !== workspaceId;
  const projects = isProjectsLoading ? EMPTY_PROJECTS : projectLoad.projects;
  const projectsError = isProjectsLoading ? null : projectLoad.error;
  const isTasksLoading = isProjectsLoading || taskLoad.organizationId !== workspaceId;
  const currentTasks =
    taskLoad.organizationId === workspaceId ? taskLoad.tasks : [];
  const tasksError =
    taskLoad.organizationId === workspaceId ? taskLoad.error : null;
  const canViewAudit = workspace.role === "OWNER" || workspace.role === "ADMIN";
  const isActivityLoading = canViewAudit && activityLoad.organizationId !== workspaceId;
  const currentActivities = activityLoad.organizationId === workspaceId
    ? activityLoad.items
    : [];
  const activityError = activityLoad.organizationId === workspaceId
    ? activityLoad.error
    : null;

  useEffect(() => {
    if (window.location.hash === "#notifications") {
      setIsNotificationsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) return;

    let active = true;

    async function loadProjects() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Your session is unavailable. Sign in again to continue.");
        }
        const result = await listProjects(token, workspaceId);
        if (active) {
          setProjectLoad({
            organizationId: workspaceId,
            projects: result,
            error: null,
          });
        }
      } catch (requestError) {
        if (active) {
          setProjectLoad({
            organizationId: workspaceId,
            projects: [],
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load projects. Please try again.",
          });
        }
      }
    }

    void loadProjects();
    return () => {
      active = false;
    };
  }, [getToken, projectRetry, workspaceId]);

  useEffect(() => {
    if (isProjectsLoading) return;
    let active = true;

    async function loadTasks() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Your session is unavailable. Sign in again to continue.");
        }
        const projectTasks = await Promise.all(
          projects.map(async (project) => {
            try {
              return await listProjectTasks(token, workspaceId, project.id);
            } catch (requestError) {
              if (requestError instanceof TaskApiError && requestError.status === 404) {
                return [];
              }
              throw requestError;
            }
          }),
        );
        if (active) {
          setTaskLoad({
            organizationId: workspaceId,
            tasks: projectTasks
              .flat()
              .filter((task) => !task.archivedAt)
              .map((task) => ({
                id: task.id,
                workspaceId,
                projectId: task.projectId,
                title: task.title,
                status: task.status,
                priority: task.priority,
                dueDate: task.dueAt?.slice(0, 10) ?? null,
                archivedAt: task.archivedAt,
              })),
            error: null,
          });
        }
      } catch (requestError) {
        if (active) {
          setTaskLoad({
            organizationId: workspaceId,
            tasks: [],
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load tasks. Please try again.",
          });
        }
      }
    }

    void loadTasks();
    return () => {
      active = false;
    };
  }, [getToken, isProjectsLoading, projects, taskRetry, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    if (!canViewAudit) {
      setActivityLoad({ organizationId: workspaceId, items: [], error: null });
      return;
    }
    let active = true;

    async function loadActivity() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session is unavailable. Sign in again to continue.");
        const page = await listOrganizationAuditLogs(token, workspaceId, {
          page: 1,
          pageSize: 8,
        });
        if (active) {
          setActivityLoad({ organizationId: workspaceId, items: page.items, error: null });
        }
      } catch (requestError) {
        if (active) {
          setActivityLoad({
            organizationId: workspaceId,
            items: [],
            error: requestError instanceof Error
              ? requestError.message
              : "We couldn’t load recent activity.",
          });
        }
      }
    }

    void loadActivity();
    return () => {
      active = false;
    };
  }, [activityRetry, canViewAudit, getToken, workspaceId]);

  useEffect(() => {
    if (!projectNotice) return;
    const timeoutId = window.setTimeout(() => setProjectNotice(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [projectNotice]);

  async function getSessionToken(): Promise<string> {
    const token = await getToken();
    if (!token) {
      throw new Error("Your session is unavailable. Sign in again to continue.");
    }
    return token;
  }

  function handleWorkspaceChange(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setActiveSection("home");
    router.replace(organizationDashboardPath(nextWorkspaceId));
  }

  async function saveProject(input: ProjectInput) {
    const token = await getSessionToken();
    if (typeof projectDialog === "object" && projectDialog !== null) {
      const updated = await updateProject(
        token,
        workspaceId,
        projectDialog.id,
        input,
      );
      setProjectLoad((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === updated.id ? updated : project,
        ),
      }));
      setProjectNotice("Project changes saved.");
      return;
    }

    const created = await createProject(token, workspaceId, input);
    setProjectLoad((current) => ({
      ...current,
      projects: [created, ...current.projects],
    }));
    setProjectNotice("Project created.");
  }

  async function handleArchive(project: OrganizationProject) {
    if (!window.confirm(`Archive “${project.name}”? You can still view it later.`)) {
      return;
    }
    try {
      const token = await getSessionToken();
      const archived = await archiveProject(token, workspaceId, project.id);
      setProjectLoad((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.id === archived.id ? archived : item,
        ),
      }));
      setProjectNotice("Project archived.");
    } catch (requestError) {
      setProjectLoad((current) => ({
        ...current,
        error:
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t archive this project. Please try again.",
      }));
    }
  }

  async function handleRestore(project: OrganizationProject) {
    try {
      const token = await getSessionToken();
      const restored = await restoreProject(token, workspaceId, project.id);
      setProjectLoad((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.id === restored.id ? restored : item,
        ),
      }));
      setProjectNotice("Project restored.");
    } catch (requestError) {
      setProjectLoad((current) => ({
        ...current,
        error:
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t restore this project. Please try again.",
      }));
    }
  }

  const canCreateProject =
    workspace.role === "OWNER" ||
    workspace.role === "ADMIN" ||
    workspace.role === "MANAGER";
  const firstName = user?.firstName
    ?? user?.fullName?.trim().split(/\s+/u)[0]
    ?? "there";
  const roleLabel = workspace.role.charAt(0) + workspace.role.slice(1).toLowerCase();
  const homeHref = organizationDashboardPath(workspaceId);
  return (
    <div className="dashboard-shell" id="home">
      <DashboardSidebar
        activeSection={activeSection}
        canViewAudit={canViewAudit}
        homeHref={homeHref}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
        onNotifications={() => setIsNotificationsOpen((open) => !open)}
        onSectionChange={setActiveSection}
        onWorkspaceChange={handleWorkspaceChange}
        workspaceId={workspaceId}
        workspaces={workspaces}
      />
      {isMobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setIsMobileNavOpen(false)}
          type="button"
        />
      )}
      <main className="main-area">
        <header className="app-header">
          <button
            aria-label="Open navigation"
            className="mobile-menu-button"
            onClick={() => setIsMobileNavOpen(true)}
            type="button"
          >
            <Icon name="menu" width={22} height={22} />
          </button>
          <label className="search-wrap">
            <Icon name="search" width={18} height={18} />
            <span className="sr-only">Search projects and tasks</span>
            <input
              className="search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects or tasks…"
              type="search"
              value={search}
            />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="header-actions">
            <NotificationCenter
              isOpen={isNotificationsOpen}
              onOpenChange={setIsNotificationsOpen}
            />
            <div className="header-profile">
              <UserButton />
              <span>
                <strong>{user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "NEXUS member"}</strong>
                <small>{roleLabel}</small>
              </span>
            </div>
          </div>
        </header>
        <div className="dashboard-content">
          <section className="welcome-row" aria-labelledby="welcome-title">
            <div className="welcome-copy">
              <span className="welcome-mark" aria-hidden="true">
                <Icon name="spark" width={27} height={27} />
              </span>
              <div>
                <p className="welcome-eyebrow">{workspace.name} · {roleLabel}</p>
                <h1 id="welcome-title">Welcome back, {firstName}!</h1>
                <p>Here&apos;s what&apos;s happening in your workspace today.</p>
              </div>
            </div>
            {canCreateProject && (
              <button
                className="button button-primary welcome-action"
                onClick={() => setProjectDialog("create")}
                type="button"
              >
                <Icon name="plus" width={17} height={17} />
                New project
              </button>
            )}
          </section>

          <OrganizationAnalyticsPanel organizationId={workspaceId} />

          <div className="content-grid">
            <ProjectsSection
              canCreate={canCreateProject}
              error={projectsError}
              isLoading={isProjectsLoading}
              onArchive={handleArchive}
              onCreate={() => setProjectDialog("create")}
              onEdit={setProjectDialog}
              onRestore={handleRestore}
              onRetry={() => setProjectRetry((value) => value + 1)}
              organizationId={workspaceId}
              projects={projects}
              search={search}
              tasks={currentTasks}
            />
            <ActivitySection
              activities={currentActivities}
              canView={canViewAudit}
              error={activityError}
              isLoading={isActivityLoading}
              onRetry={() => setActivityRetry((value) => value + 1)}
              organizationId={workspaceId}
            />
          </div>
          <QuickActionsSection
            canCreateProject={canCreateProject}
            canViewAudit={canViewAudit}
            onCreateProject={() => setProjectDialog("create")}
            onNotifications={() => setIsNotificationsOpen(true)}
            organizationId={workspaceId}
          />
          <TasksSection
            key={workspaceId}
            onClearSearch={() => setSearch("")}
            error={tasksError}
            isLoading={isTasksLoading}
            onRetry={() => setTaskRetry((value) => value + 1)}
            organizationId={workspaceId}
            projects={projects}
            search={search}
            tasks={currentTasks}
          />
          <p className="workspace-footnote">{workspace.name} · Organization workspace</p>
        </div>
      </main>
      {projectDialog && (
        <ProjectDialog
          onClose={() => setProjectDialog(null)}
          onSave={saveProject}
          project={typeof projectDialog === "object" ? projectDialog : undefined}
        />
      )}
      {projectNotice && (
        <div className="toast" role="status">
          <Icon name="check" width={16} height={16} />
          {projectNotice}
        </div>
      )}
    </div>
  );
}
