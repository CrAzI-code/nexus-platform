import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import OrganizationGate from "./organization-gate";

async function AuthenticatedDashboard() {
  await auth.protect();
  return <OrganizationGate />;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="workspace-gate">Loading your workspace…</div>}>
      <AuthenticatedDashboard />
    </Suspense>
  );
}
