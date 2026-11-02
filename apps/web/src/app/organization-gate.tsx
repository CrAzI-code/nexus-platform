"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Dashboard from "@/components/dashboard/dashboard";
import type { Workspace } from "@/components/dashboard/dashboard-data";
import {
  listOrganizations,
  type OrganizationMembership,
} from "@/lib/organizations";

function toWorkspace(organization: OrganizationMembership): Workspace {
  const initials = organization.name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return {
    id: organization.id,
    name: organization.name,
    plan: `${organization.role.toLowerCase()} workspace`,
    initials: initials || "NX",
    role: organization.role,
  };
}

export default function OrganizationGate() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;

    let active = true;
    async function loadOrganizations() {
      try {
        if (!isSignedIn) {
          throw new Error("Sign in to access your organizations.");
        }
        const token = await getToken();
        if (!token) {
          throw new Error("Your session is unavailable. Sign in again to continue.");
        }
        const organizations = await listOrganizations(token);
        if (!active) return;
        if (organizations.length === 0) {
          router.replace("/onboarding");
          return;
        }
        setWorkspaces(organizations.map(toWorkspace));
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load your organizations. Please try again.",
          );
        }
      }
    }

    void loadOrganizations();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, retry, router]);

  if (error) {
    return (
      <main className="workspace-gate" role="alert">
        <section className="workspace-gate-card">
          <span className="onboarding-mark">N</span>
          <h1>We couldn’t load your workspace</h1>
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

  if (!isLoaded || !workspaces) {
    return (
      <main className="workspace-gate" aria-live="polite">
        <p>Loading your NEXUS workspace…</p>
      </main>
    );
  }

  return <Dashboard workspaces={workspaces} />;
}
