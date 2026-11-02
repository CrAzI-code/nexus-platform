"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import {
  initialActivity,
  initialTasks,
  type Activity,
  type Task,
  type Workspace,
} from "./dashboard-data";
import { DashboardSidebar, type DashboardSection } from "./dashboard-sidebar";
import {
  ActivitySection,
  OverviewSection,
  ProjectsSection,
  TasksSection,
} from "./dashboard-sections";
import { Icon } from "./icons";
import { ProjectDialog } from "./project-dialog";
import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
  type OrganizationProject,
  type ProjectInput,
} from "@/lib/organizations";

const EMPTY_PROJECTS: OrganizationProject[] = [];

export default function Dashboard({ workspaces }: { workspaces: Workspace[] }) {
  const { getToken } = useAuth();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState<DashboardSection>("home");
  const [search, setSearch] = useState("");
  const [tasks] = useState<Task[]>(initialTasks);
  const [activities] = useState<Activity[]>(initialActivity);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(true);
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

  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const isProjectsLoading = projectLoad.organizationId !== workspaceId;
  const projects = isProjectsLoading ? EMPTY_PROJECTS : projectLoad.projects;
  const projectsError = isProjectsLoading ? null : projectLoad.error;
  const currentTasks = useMemo(
    () => tasks.filter((task) => task.workspaceId === workspaceId),
    [tasks, workspaceId],
  );
  const currentActivities = useMemo(
    () => activities.filter((activity) => activity.workspaceId === workspaceId),
    [activities, workspaceId],
  );

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

  const canCreateProject =
    workspace.role === "OWNER" ||
    workspace.role === "ADMIN" ||
    workspace.role === "MANAGER";
  const taskProjects = useMemo(
    () => projects.map(({ id, name }) => ({ id, name })),
    [projects],
  );

  return (
    <div className="dashboard-shell" id="home">
      <DashboardSidebar
        activeSection={activeSection}
        onNotifications={() => setIsNotificationsOpen((open) => !open)}
        onSectionChange={setActiveSection}
        onWorkspaceChange={setWorkspaceId}
        workspaceId={workspaceId}
        workspaces={workspaces}
      />
      <main className="main-area">
        <div className="dashboard-content">
          <header className="topbar">
            <div className="page-heading">
              <h1>{workspace.name}</h1>
              <p>Your organization&apos;s workspace at a glance.</p>
            </div>
            <div className="header-actions">
              <label className="search-wrap">
                <Icon name="search" width={17} height={17} />
                <span className="sr-only">Search projects, tasks, and activity</span>
                <input
                  className="search-input"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search anything..."
                  type="search"
                  value={search}
                />
              </label>
              <div className="notification-wrap">
                <button
                  aria-expanded={isNotificationsOpen}
                  aria-label="Notifications"
                  className="icon-button"
                  onClick={() => setIsNotificationsOpen((open) => !open)}
                  type="button"
                >
                  <Icon name="bell" width={18} height={18} />
                  {hasUnreadNotifications && <span className="notification-dot" />}
                </button>
                {isNotificationsOpen && (
                  <div className="notification-popover" role="region" aria-label="Notifications">
                    <div className="popover-heading">
                      <strong>Notifications</strong>
                      {hasUnreadNotifications && (
                        <button
                          className="text-button"
                          onClick={() => setHasUnreadNotifications(false)}
                          type="button"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    {hasUnreadNotifications ? (
                      <div className="notification-item">
                        <span className="notification-bullet" />
                        {workspaceId === "nexus" ? (
                          <p>
                            Jordan mentioned you in <strong>Onboarding flow</strong>
                            <span>Mobile app redesign · 48 minutes ago</span>
                          </p>
                        ) : (
                          <p>
                            Maya shared new notes in <strong>Activation interviews</strong>
                            <span>Customer research · 20 minutes ago</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="notification-empty">You&apos;re all caught up.</p>
                    )}
                  </div>
                )}
              </div>
              {canCreateProject && (
                <button
                  className="primary-button"
                  onClick={() => setProjectDialog("create")}
                  type="button"
                >
                  <Icon name="plus" width={16} height={16} />
                  <span>New project</span>
                </button>
              )}
            </div>
          </header>

          <p className="mock-notice">
            <Icon name="info" width={14} height={14} />
            Projects are connected to your organization. Tasks and activity are not part of this milestone.
          </p>

          <OverviewSection tasks={currentTasks} />

          <div className="content-grid">
            <div className="primary-column">
              <ProjectsSection
                canCreate={canCreateProject}
                error={projectsError}
                isLoading={isProjectsLoading}
                onArchive={handleArchive}
                onCreate={() => setProjectDialog("create")}
                onEdit={setProjectDialog}
                onRetry={() => setProjectRetry((value) => value + 1)}
                organizationId={workspaceId}
                projects={projects}
                search={search}
              />
              <TasksSection
                key={workspaceId}
                onClearSearch={() => setSearch("")}
                projects={taskProjects}
                search={search}
                tasks={currentTasks}
              />
            </div>
            <div className="secondary-column">
              <ActivitySection activities={currentActivities} search={search} />
            </div>
          </div>
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
