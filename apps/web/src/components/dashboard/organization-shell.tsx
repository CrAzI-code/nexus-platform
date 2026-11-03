"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { listOrganizations } from "@/lib/organizations";
import { organizationDashboardPath } from "@/lib/routes";
import { toWorkspace, type Workspace } from "./dashboard-data";
import { DashboardSidebar, type DashboardSection } from "./dashboard-sidebar";
import { Icon } from "./icons";

const OrganizationWorkspaceContext = createContext<Workspace | null>(null);

export function useOrganizationWorkspace(): Workspace | null {
  return useContext(OrganizationWorkspaceContext);
}

export function OrganizationShell({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const { getToken } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadWorkspaces() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error(
            "Your session is unavailable. Sign in again to continue.",
          );
        }
        const organizations = await listOrganizations(token);
        if (!active) return;
        setWorkspaces(organizations.map(toWorkspace));
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load organization navigation.",
        );
      }
    }

    void loadWorkspaces();
    return () => {
      active = false;
    };
  }, [getToken, retry]);

  if (error) {
    return (
      <main className="workspace-gate" role="alert">
        <section className="workspace-gate-card">
          <span className="onboarding-mark">N</span>
          <h1>We couldn&apos;t load navigation</h1>
          <p>{error}</p>
          <button
            className="onboarding-submit"
            onClick={() => {
              setError(null);
              setWorkspaces(null);
              setRetry((value) => value + 1);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!workspaces) {
    return (
      <main className="workspace-gate">Loading organization navigation…</main>
    );
  }

  if (workspaces.length === 0) {
    return (
      <main className="workspace-gate" role="alert">
        <section className="workspace-gate-card">
          <h1>No organization available</h1>
          <p>Create an organization before opening organization pages.</p>
          <Link className="button button-primary" href="/onboarding">
            Create organization
          </Link>
        </section>
      </main>
    );
  }

  const workspace = workspaces.find((item) => item.id === organizationId);
  if (!workspace) {
    return (
      <main className="workspace-gate" role="alert">
        <section className="workspace-gate-card">
          <h1>Organization unavailable</h1>
          <p>You no longer have access to this organization.</p>
          <Link
            className="button button-primary"
            href={organizationDashboardPath(workspaces[0].id)}
          >
            Return home
          </Link>
        </section>
      </main>
    );
  }

  const activeSection: DashboardSection | null = pathname.includes("/projects/")
    ? "projects"
    : null;
  const activeOrganizationPage = pathname.endsWith("/audit-logs")
    ? "audit"
    : pathname.endsWith("/members")
      ? "people"
      : pathname.endsWith("/files")
        ? "files"
        : undefined;
  const homeHref = organizationDashboardPath(organizationId);
  const canViewAudit = workspace.role === "OWNER" || workspace.role === "ADMIN";

  return (
    <OrganizationWorkspaceContext.Provider value={workspace}>
      <div className="dashboard-shell organization-app-shell">
        <DashboardSidebar
          activeSection={activeSection}
          activeOrganizationPage={activeOrganizationPage}
          canViewAudit={canViewAudit}
          homeHref={homeHref}
          isMobileOpen={isMobileOpen}
          onMobileClose={() => setIsMobileOpen(false)}
          onNotifications={() =>
            router.push(
              organizationDashboardPath(organizationId, "notifications"),
            )
          }
          onSectionChange={() => undefined}
          onWorkspaceChange={(nextOrganizationId) => {
            setIsMobileOpen(false);
            router.push(organizationDashboardPath(nextOrganizationId));
          }}
          workspaceId={organizationId}
          workspaces={workspaces}
        />
        {isMobileOpen && (
          <button
            aria-label="Close navigation"
            className="sidebar-backdrop"
            onClick={() => setIsMobileOpen(false)}
            type="button"
          />
        )}
        <div className="main-area organization-main-area">
          <header className="organization-mobile-header">
            <button
              aria-label="Open navigation"
              className="mobile-menu-button"
              onClick={() => setIsMobileOpen(true)}
              type="button"
            >
              <Icon name="menu" width={22} height={22} />
            </button>
            <Link href={homeHref}>NEXUS</Link>
          </header>
          {children}
        </div>
      </div>
    </OrganizationWorkspaceContext.Provider>
  );
}
