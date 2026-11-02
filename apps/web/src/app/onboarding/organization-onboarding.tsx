"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createOrganization } from "@/lib/organizations";

export default function OrganizationOnboarding() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);

  useEffect(() => {
    if (!createdName) return;
    const timeoutId = window.setTimeout(() => router.replace("/"), 1100);
    return () => window.clearTimeout(timeoutId);
  }, [createdName, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const organizationName = name.trim();
    if (!organizationName || Array.from(organizationName).length > 100) {
      setError("Enter an organization name between 1 and 100 characters.");
      return;
    }
    if (!isLoaded || !isSignedIn) {
      setError("Sign in to create an organization.");
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      if (!token) {
        setError("Your session is unavailable. Sign in again to continue.");
        return;
      }
      const organization = await createOrganization(token, organizationName);
      setCreatedName(organization.name);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t create your organization. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card">
        <Link className="onboarding-brand" href="/" aria-label="NEXUS home">
          <span className="onboarding-mark">N</span>
          <span>NEXUS</span>
        </Link>

        {createdName ? (
          <div className="onboarding-success" role="status">
            <span className="success-mark" aria-hidden="true">✓</span>
            <p className="onboarding-eyebrow">Workspace created</p>
            <h1>Welcome to {createdName}</h1>
            <p>
              Your organization is ready. Taking you to your workspace…
            </p>
          </div>
        ) : (
          <>
            <p className="onboarding-eyebrow">A better way to work together</p>
            <h1>Create your organization</h1>
            <p className="onboarding-description">
              Set up your team’s home for projects, tasks, and collaboration.
              You’ll be its owner and can invite teammates later.
            </p>

            <form className="onboarding-form" onSubmit={submit}>
              <label htmlFor="organization-name">Organization name</label>
              <input
                autoComplete="organization"
                id="organization-name"
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Northstar Studio"
                required
                value={name}
              />
              <span className="onboarding-hint">
                You can change this later.
              </span>
              {error && (
                <p className="onboarding-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="onboarding-submit"
                disabled={!isLoaded || isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Creating your workspace…" : "Create organization"}
              </button>
            </form>

            <p className="onboarding-legal">
              Your organization data is managed securely by NEXUS.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
