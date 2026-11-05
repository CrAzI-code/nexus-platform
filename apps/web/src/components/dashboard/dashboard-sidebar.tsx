"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import type { Workspace } from "./dashboard-data";
import { Icon, type IconName } from "./icons";
import {
  organizationAuditLogsPath,
  organizationDashboardPath,
  organizationFilesPath,
  organizationMembersPath,
  organizationSettingsPath,
} from "@/lib/routes";

export type DashboardSection = "home" | "work" | "projects";

type DashboardSidebarProps = {
  activeSection: DashboardSection | null;
  activeOrganizationPage?: "people" | "audit" | "files" | "settings";
  workspaces: Workspace[];
  workspaceId: string;
  homeHref: string;
  onSectionChange: (section: DashboardSection) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onNotifications: () => void;
  canViewAudit: boolean;
  isMobileOpen: boolean;
  onMobileClose: () => void;
};

const primaryNavigation: {
  id: DashboardSection;
  label: string;
  icon: IconName;
}[] = [
  { id: "home", label: "Home", icon: "grid" },
  { id: "work", label: "My Work", icon: "check-square" },
  { id: "projects", label: "Projects", icon: "briefcase" },
];

export function DashboardSidebar({
  activeSection,
  activeOrganizationPage,
  workspaces,
  workspaceId,
  homeHref,
  onSectionChange,
  onWorkspaceChange,
  onNotifications,
  canViewAudit,
  isMobileOpen,
  onMobileClose,
}: DashboardSidebarProps) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspace =
    workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const { isLoaded, user } = useUser();
  const displayName =
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress ??
    "Workspace member";
  const roleLabel = `${workspace.role.charAt(0)}${workspace.role.slice(1).toLowerCase()}`;

  return (
    <aside
      className={`sidebar${isMobileOpen ? " is-mobile-open" : ""}`}
      aria-label="Workspace navigation"
    >
      <Link
        className="brand"
        href={homeHref}
        onClick={() => {
          onSectionChange("home");
          onMobileClose();
        }}
        aria-label="NEXUS home"
      >
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        <span className="brand-name">NEXUS</span>
      </Link>

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
          <div
            className="workspace-menu"
            role="listbox"
            aria-label="Switch workspace"
          >
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
                  onMobileClose();
                }}
                role="option"
                type="button"
              >
                <span className="workspace-icon">{item.initials}</span>
                <span className="workspace-copy">
                  <strong>{item.name}</strong>
                  <span>{item.plan}</span>
                </span>
                {item.id === workspaceId && (
                  <Icon name="check" width={15} height={15} />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="sidebar-label">Workspace</p>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {primaryNavigation.map((item) => (
          <Link
            aria-current={activeSection === item.id ? "page" : undefined}
            className="nav-link"
            href={
              item.id === "home"
                ? homeHref
                : organizationDashboardPath(
                    workspaceId,
                    item.id === "work" ? "my-tasks" : "projects",
                  )
            }
            key={item.id}
            onClick={() => {
              onSectionChange(item.id);
              onMobileClose();
            }}
            title={item.label}
          >
            <Icon name={item.icon} width={18} height={18} />
            <span>{item.label}</span>
          </Link>
        ))}
        <Link
          aria-current={activeOrganizationPage === "files" ? "page" : undefined}
          className="nav-link"
          href={organizationFilesPath(workspaceId)}
          onClick={onMobileClose}
          title="Files"
        >
          <Icon name="file" width={18} height={18} />
          <span>Files</span>
        </Link>
        <Link
          aria-current={
            activeOrganizationPage === "people" ? "page" : undefined
          }
          className="nav-link"
          href={organizationMembersPath(workspaceId)}
          onClick={onMobileClose}
          title="People"
        >
          <Icon name="users" width={18} height={18} />
          <span>People</span>
        </Link>
        <button
          aria-label="Open notifications"
          className="nav-action"
          onClick={() => {
            onNotifications();
            onMobileClose();
          }}
          title="Notifications"
          type="button"
        >
          <Icon name="bell" width={18} height={18} />
          <span>Notifications</span>
        </button>
        {canViewAudit && (
          <Link
            aria-current={
              activeOrganizationPage === "audit" ? "page" : undefined
            }
            className="nav-link"
            href={organizationAuditLogsPath(workspaceId)}
            onClick={onMobileClose}
            title="Audit logs"
          >
            <Icon name="activity" width={18} height={18} />
            <span>Audit logs</span>
          </Link>
        )}
        <Link
          aria-current={
            activeOrganizationPage === "settings" ? "page" : undefined
          }
          className="nav-link"
          href={organizationSettingsPath(workspaceId)}
          onClick={onMobileClose}
          title="Settings"
        >
          <Icon name="settings" width={18} height={18} />
          <span>Settings</span>
        </Link>
      </nav>

      <div className="sidebar-spacer" />
      <div
        className="profile-card"
        aria-label={`Signed-in account: ${displayName}, ${roleLabel}`}
      >
        <UserButton />
        <span className="profile-copy">
          <strong>{isLoaded ? displayName : "Loading account…"}</strong>
          <span>{roleLabel}</span>
        </span>
        <Icon
          className="profile-menu-indicator"
          name="chevron-down"
          width={14}
          height={14}
        />
      </div>
    </aside>
  );
}
