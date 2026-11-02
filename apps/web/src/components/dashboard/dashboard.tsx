"use client";

import { useEffect, useMemo, useState } from "react";
import {
  initialActivity,
  initialTasks,
  projects as allProjects,
  type Activity,
  type Task,
  type TaskPriority,
  type Workspace,
} from "./dashboard-data";
import { DashboardSidebar, type DashboardSection } from "./dashboard-sidebar";
import {
  ActivitySection,
  OverviewSection,
  ProjectsSection,
  TasksSection,
} from "./dashboard-sections";
import { NewTaskDialog } from "./new-task-dialog";
import { Icon } from "./icons";

export default function Dashboard({ workspaces }: { workspaces: Workspace[] }) {
  const [workspaceId, setWorkspaceId] = useState(
    workspaces[workspaces.length - 1]?.id ?? "",
  );
  const [activeSection, setActiveSection] = useState<DashboardSection>("home");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activities] = useState<Activity[]>(initialActivity);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(true);
  const [taskCreated, setTaskCreated] = useState(false);

  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const currentProjects = useMemo(
    () => allProjects.filter((project) => project.workspaceId === workspaceId),
    [workspaceId],
  );
  const currentTasks = useMemo(
    () => tasks.filter((task) => task.workspaceId === workspaceId),
    [tasks, workspaceId],
  );
  const currentActivities = useMemo(
    () => activities.filter((activity) => activity.workspaceId === workspaceId),
    [activities, workspaceId],
  );

  useEffect(() => {
    if (!taskCreated) return;
    const timeoutId = window.setTimeout(() => setTaskCreated(false), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [taskCreated]);

  function createTask(details: {
    title: string;
    projectId: string;
    priority: TaskPriority;
    dueDate: string;
  }) {
    const newTask: Task = {
      ...details,
      id: `task-${Date.now()}`,
      workspaceId,
      status: "TODO",
      dueDate: details.dueDate || null,
    };
    setTasks((currentTasks) => [newTask, ...currentTasks]);
    setIsTaskDialogOpen(false);
    setTaskCreated(true);
  }

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
              <button
                className="primary-button"
                onClick={() => setIsTaskDialogOpen(true)}
                type="button"
              >
                <Icon name="plus" width={16} height={16} />
                <span>New task</span>
              </button>
            </div>
          </header>

          <p className="mock-notice">
            <Icon name="info" width={14} height={14} />
            Dashboard preview · Organization access is live; project, task, and activity data below is sample data.
          </p>

          <OverviewSection tasks={currentTasks} />

          <div className="content-grid">
            <div className="primary-column">
              <ProjectsSection projects={currentProjects} search={search} />
              <TasksSection
                key={workspaceId}
                onClearSearch={() => setSearch("")}
                onCreateTask={() => setIsTaskDialogOpen(true)}
                projects={currentProjects}
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
      {isTaskDialogOpen && (
        <NewTaskDialog
          onClose={() => setIsTaskDialogOpen(false)}
          onCreate={createTask}
          projects={currentProjects}
        />
      )}
      {taskCreated && (
        <div className="toast" role="status">
          <Icon name="check" width={16} height={16} />
          Task added to your workspace.
        </div>
      )}
    </div>
  );
}
