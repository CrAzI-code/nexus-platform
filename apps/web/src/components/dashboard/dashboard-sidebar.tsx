"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { useState } from "react";
import type { Workspace } from "./dashboard-data";
import { Icon, type IconName } from "./icons";

export type DashboardSection = "home" | "work" | "projects";

type DashboardSidebarProps = {
  activeSection: DashboardSection;
  workspaces: Workspace[];
  workspaceId: string;
  onSectionChange: (section: DashboardSection) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onNotifications: () => void;
};

const primaryNavigation: {
  id: DashboardSection;
  label: string;
  icon: IconName;
  href: string;
}[] = [
  { id: "home", label: "Home", icon: "grid", href: "#home" },
  { id: "work", label: "My Work", icon: "check-square", href: "#my-tasks" },
  { id: "projects", label: "Projects", icon: "briefcase", href: "#projects" },
];

const upcomingNavigation: { label: string; icon: IconName }[] = [
  { label: "Messages", icon: "message" },
  { label: "People", icon: "users" },
  { label: "Settings", icon: "settings" },
];

export function DashboardSidebar({
  activeSection,
  workspaces,
  workspaceId,
  onSectionChange,
  onWorkspaceChange,
  onNotifications,
}: DashboardSidebarProps) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const { isLoaded, user } = useUser();
  const displayName =
    user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Workspace member";
  const email = user?.primaryEmailAddress?.emailAddress ?? "NEXUS account";

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <a
        className="brand"
        href="#home"
        onClick={() => onSectionChange("home")}
        aria-label="NEXUS home"
      >
        <span className="brand-mark">
          <Icon name="spark" width={20} height={20} />
        </span>
        <span className="brand-name">NEXUS</span>
      </a>

      <div className="workspace-picker">
        <button
          aria-label={`Switch workspace, current workspace ${workspace.name}`}
          aria-expanded={workspaceMenuOpen}
          aria-haspopup="listbox"
          className="workspace-switcher"
          onClick={() => setWorkspaceMenuOpen((open) => !open)}
          type="button"
        >
          <span className="workspace-icon">{workspace.initials}</span>
          <span className="workspace-copy">
            <strong>{workspace.name}</strong>
            <span>{workspace.plan}</span>
          </span>
          <Icon name="chevron-down" width={15} height={15} />
        </button>
        {workspaceMenuOpen && (
          <div className="workspace-menu" role="listbox" aria-label="Switch workspace">
            {workspaces.map((item) => (
              <button
                aria-label={`Switch to ${item.name}`}
                aria-selected={item.id === workspaceId}
                className="workspace-option"
                key={item.id}
                onClick={() => {
                  onWorkspaceChange(item.id);
                  setWorkspaceMenuOpen(false);
                  onSectionChange("home");
                }}
                role="option"
                type="button"
              >
                <span className="workspace-icon">{item.initials}</span>
                <span className="workspace-copy">
                  <strong>{item.name}</strong>
                  <span>{item.plan}</span>
                </span>
                {item.id === workspaceId && <Icon name="check" width={15} height={15} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="sidebar-label">Workspace</p>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {primaryNavigation.map((item) => (
          <a
            aria-current={activeSection === item.id ? "page" : undefined}
            className="nav-link"
            href={item.href}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            title={item.label}
          >
            <Icon name={item.icon} width={18} height={18} />
            <span>{item.label}</span>
          </a>
        ))}
        {upcomingNavigation.map((item) => (
          <div
            aria-disabled="true"
            className="nav-disabled"
            key={item.label}
            title={`${item.label} is not available in this preview`}
          >
            <Icon name={item.icon} width={18} height={18} />
            <span>{item.label}</span>
            <span className="nav-soon">Soon</span>
          </div>
        ))}
        <button
          aria-label="Open notifications"
          className="nav-action"
          onClick={onNotifications}
          title="Notifications"
          type="button"
        >
          <Icon name="bell" width={18} height={18} />
          <span>Notifications</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />
      <div className="profile-card" aria-label="Signed-in account">
        <UserButton />
        <span className="profile-copy">
          <strong>{isLoaded ? displayName : "Loading account…"}</strong>
          <span>{email}</span>
        </span>
      </div>
    </aside>
  );
}
