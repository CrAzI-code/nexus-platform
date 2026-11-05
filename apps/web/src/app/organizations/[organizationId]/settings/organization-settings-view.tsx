"use client";

import { UserProfile, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/dashboard/icons";
import {
  useOrganizationWorkspace,
  useUpdateOrganizationWorkspaceName,
} from "@/components/dashboard/organization-shell";
import { updateOrganizationName } from "@/lib/organizations";
import {
  organizationDashboardPath,
  organizationMembersPath,
} from "@/lib/routes";

export default function OrganizationSettingsView({
  organizationId,
}: {
  organizationId: string;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const workspace = useOrganizationWorkspace();
  const updateWorkspaceName = useUpdateOrganizationWorkspaceName();
  const [name, setName] = useState(workspace?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEditOrganization =
    workspace?.role === "OWNER" || workspace?.role === "ADMIN";
  const isDirty = name.trim() !== workspace?.name;

  async function saveOrganizationName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const normalizedName = name.trim();
    if (
      !normalizedName ||
      Array.from(normalizedName).length > 100 ||
      /\p{Cc}/u.test(normalizedName)
    ) {
      setError("Enter an organization name between 1 and 100 characters.");
      return;
    }
    if (
      !window.confirm(`Change the organization name to “${normalizedName}”?`)
    ) {
      return;
    }

    setIsSaving(true);
    try {
      if (!isLoaded || !isSignedIn) {
        throw new Error("Sign in again before changing organization settings.");
      }
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const updated = await updateOrganizationName(
        token,
        organizationId,
        normalizedName,
      );
      updateWorkspaceName?.(updated.name);
      setName(updated.name);
      setNotice("Organization name updated.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t save the organization name. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!workspace) {
    return (
      <main className="settings-page-shell" aria-live="polite">
        <p>Loading organization settings…</p>
      </main>
    );
  }

  return (
    <main className="settings-page-shell">
      <nav className="audit-breadcrumbs" aria-label="Breadcrumb">
        <Link href={organizationDashboardPath(organizationId)}>Home</Link>
        <Icon name="chevron-right" width={13} height={13} />
        <span>{workspace.name}</span>
        <Icon name="chevron-right" width={13} height={13} />
        <span aria-current="page">Settings</span>
      </nav>

      <header className="settings-page-header">
        <span className="audit-page-kicker">
          <Icon name="settings" width={14} height={14} />
          Workspace configuration
        </span>
        <h1>Settings</h1>
        <p>Manage your organization profile and personal account.</p>
      </header>

      <section
        className="settings-card"
        aria-labelledby="organization-profile-title"
      >
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon name="briefcase" width={18} height={18} />
          </span>
          <div>
            <h2 id="organization-profile-title">Organization profile</h2>
            <p>Basic details shared with everyone in this workspace.</p>
          </div>
          <span className="team-role-chip">{workspace.role}</span>
        </div>
        <form className="settings-name-form" onSubmit={saveOrganizationName}>
          <label className="form-field">
            <span>Organization name</span>
            <input
              autoComplete="organization"
              className="form-control"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
                setNotice(null);
              }}
              readOnly={!canEditOrganization}
              required
              value={name}
            />
            <small>
              {canEditOrganization
                ? "Up to 100 characters. Owners and Admins can update this name for the organization."
                : "Only organization Owners and Admins can change this name."}
            </small>
          </label>
          {canEditOrganization && (
            <button
              className="primary-button"
              disabled={!isLoaded || isSaving || !isDirty}
              type="submit"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          )}
        </form>
        {error && (
          <p className="settings-message is-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="settings-message is-success" role="status">
            {notice}
          </p>
        )}
      </section>

      <section className="settings-card" aria-labelledby="preferences-title">
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon name="sliders" width={18} height={18} />
          </span>
          <div>
            <h2 id="preferences-title">Organization preferences</h2>
            <p>Workspace-wide defaults and behavior.</p>
          </div>
        </div>
        <div className="settings-empty-note">
          <Icon name="info" width={16} height={16} />
          <p>
            Organization preferences are not available yet. NEXUS does not
            currently store configurable organization-wide preferences.
          </p>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="team-settings-title">
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon name="users" width={18} height={18} />
          </span>
          <div>
            <h2 id="team-settings-title">Members and roles</h2>
            <p>
              Invite teammates, review membership, and manage roles using the
              existing Teams tools.
            </p>
          </div>
        </div>
        <Link
          className="secondary-button settings-team-link"
          href={organizationMembersPath(organizationId)}
        >
          Open team management
          <Icon name="arrow-right" width={15} height={15} />
        </Link>
      </section>

      <section
        className="settings-card settings-account-card"
        aria-labelledby="account-settings-title"
      >
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon name="users" width={18} height={18} />
          </span>
          <div>
            <h2 id="account-settings-title">Personal profile and account</h2>
            <p>
              Profile details, sign-in methods, and security options are managed
              securely by Clerk.
            </p>
          </div>
        </div>
        {isLoaded && isSignedIn ? (
          <div className="settings-clerk-profile">
            <UserProfile routing="hash" />
          </div>
        ) : (
          <p className="file-panel-state" role="status">
            Loading your account settings…
          </p>
        )}
      </section>
    </main>
  );
}
