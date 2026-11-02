"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  acceptOrganizationInvitation,
  acceptOrganizationInvitationById,
  getInvitationAcceptanceDetails,
  type InvitationAcceptanceDetails,
} from "@/lib/team";

const pendingTokenKey = "nexus.pending-invitation-token";

export default function AcceptInvitation() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [invitationToken, setInvitationToken] = useState<
    string | null | undefined
  >(undefined);
  const [invitationId, setInvitationId] = useState<
    string | null | undefined
  >(undefined);
  const [invitationDetails, setInvitationDetails] =
    useState<InvitationAcceptanceDetails | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    let active = true;
    async function restoreInvitationToken() {
      await Promise.resolve();
      const query = new URLSearchParams(window.location.search);
      const idFromLink = query.get("invitationId");
      if (idFromLink !== null) {
        const validId =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            idFromLink,
          );
        if (active) {
          setInvitationId(validId ? idFromLink : null);
          setInvitationToken(null);
        }
        return;
      }
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const tokenFromLink = fragment.get("token");
      if (tokenFromLink && /^[a-f0-9]{64}$/iu.test(tokenFromLink)) {
        window.sessionStorage.setItem(pendingTokenKey, tokenFromLink);
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (active) {
        setInvitationId(null);
        setInvitationToken(window.sessionStorage.getItem(pendingTokenKey));
      }
    }

    void restoreInvitationToken();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || typeof invitationId !== "string") return;
    const targetInvitationId = invitationId;
    let active = true;
    async function loadDetails() {
      setIsDetailsLoading(true);
      setError(null);
      try {
        const sessionToken = await getToken();
        if (!sessionToken) throw new Error("Sign in to view this invitation.");
        const details = await getInvitationAcceptanceDetails(
          sessionToken,
          targetInvitationId,
        );
        if (active) setInvitationDetails(details);
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load this invitation. Ask for a new invitation link.",
          );
        }
      } finally {
        if (active) setIsDetailsLoading(false);
      }
    }
    void loadDetails();
    return () => {
      active = false;
    };
  }, [getToken, invitationId, isLoaded, isSignedIn]);

  async function accept() {
    if (!invitationToken && !invitationId) {
      setError("This invitation link is invalid or has already been used.");
      return;
    }
    setError(null);
    setIsAccepting(true);
    try {
      const sessionToken = await getToken();
      if (!sessionToken) {
        throw new Error("Sign in to accept this invitation.");
      }
      let result;
      if (invitationId) {
        result = await acceptOrganizationInvitationById(
          sessionToken,
          invitationId,
        );
      } else if (invitationToken) {
        result = await acceptOrganizationInvitation(
          sessionToken,
          invitationToken,
        );
      } else {
        throw new Error("This invitation link is invalid or has already been used.");
      }
      if (invitationToken) window.sessionStorage.removeItem(pendingTokenKey);
      router.replace(
        `/organizations/${encodeURIComponent(result.organizationId)}/members`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t accept this invitation. Please try again.",
      );
    } finally {
      setIsAccepting(false);
    }
  }

  const invitationReturnPath = invitationId
    ? `/invitations/accept?invitationId=${encodeURIComponent(invitationId)}`
    : "/invitations/accept";
  const signInRedirect = encodeURIComponent(invitationReturnPath);
  const hasInvitation = Boolean(invitationToken || invitationId);

  return (
    <main className="onboarding-page">
      <section className="onboarding-card invitation-accept-card">
        <Link className="onboarding-brand" href="/" aria-label="NEXUS home">
          <span className="onboarding-mark">N</span>
          <span>NEXUS</span>
        </Link>
        <p className="onboarding-eyebrow">You’re invited</p>
        <h1>Join an organization</h1>
        <p className="onboarding-description">
          Accept this invitation using the NEXUS account with the invited email address.
        </p>
        {error && <p className="onboarding-error" role="alert">{error}</p>}
        {!isLoaded ||
        invitationToken === undefined ||
        invitationId === undefined ? (
          <p className="invitation-accept-status" aria-live="polite">
            Checking your invitation…
          </p>
        ) : !hasInvitation ? (
          <p className="onboarding-error" role="alert">
            This invitation link is missing or invalid. Ask an organization
            Owner or Admin for a new link.
          </p>
        ) : !isSignedIn ? (
          <div className="invitation-auth-actions">
            <Link
              className="onboarding-submit"
              href={`/sign-in?redirect_url=${signInRedirect}`}
            >
              Sign in to continue
            </Link>
            <Link
              className="invitation-signup-link"
              href={`/sign-up?redirect_url=${signInRedirect}`}
            >
              Need an account? Sign up
            </Link>
          </div>
        ) : (
          <>
            {isDetailsLoading && (
              <p className="invitation-accept-status" aria-live="polite">
                Checking invitation details…
              </p>
            )}
            {invitationDetails && (
              <p className="invitation-accept-status">
                Invitation to <strong>{invitationDetails.organizationName}</strong>
                {" · Expires "}
                {new Date(invitationDetails.expiresAt).toLocaleDateString()}
              </p>
            )}
            <button
              className="onboarding-submit"
              disabled={isAccepting || isDetailsLoading}
              onClick={() => void accept()}
              type="button"
            >
              {isAccepting ? "Accepting invitation…" : "Accept invitation"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
