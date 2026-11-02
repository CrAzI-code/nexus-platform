import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import OrganizationOnboarding from "./organization-onboarding";

async function AuthenticatedOnboarding() {
  await auth.protect();
  return <OrganizationOnboarding />;
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="workspace-gate">Loading onboarding…</div>}>
      <AuthenticatedOnboarding />
    </Suspense>
  );
}
