"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import {
  initialActivity,
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
import { NotificationCenter } from "./notification-center";
import {
  archiveProject,
  createProject,
  listProjects,
  updateProject,
  type OrganizationProject,
  type ProjectInput,
} from "@/lib/organizations";
import { listProjectTasks, TaskApiError } from "@/lib/tasks";

const EMPTY_PROJECTS: OrganizationProject[] = [];

export default function Dashboard({ workspaces }: { workspaces: Workspace[] }) {
  const { getToken } = useAuth();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState<DashboardSection>("home");
  const [search, setSearch] = useState("");
  const [activities] = useState<Activity[]>(initialActivity);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
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

  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const isProjectsLoading = projectLoad.organizationId !== workspaceId;
  const projects = isProjectsLoading ? EMPTY_PROJECTS : projectLoad.projects;
  const projectsError = isProjectsLoading ? null : projectLoad.error;
  const isTasksLoading = isProjectsLoading || taskLoad.organizationId !== workspaceId;
  const currentTasks =
    taskLoad.organizationId === workspaceId ? taskLoad.tasks : [];
  const tasksError =
    taskLoad.organizationId === workspaceId ? taskLoad.error : null;
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
              <NotificationCenter
                isOpen={isNotificationsOpen}
                onOpenChange={setIsNotificationsOpen}
              />
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
                error={tasksError}
                isLoading={isTasksLoading}
                onRetry={() => setTaskRetry((value) => value + 1)}
                organizationId={workspaceId}
                projects={projects}
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
