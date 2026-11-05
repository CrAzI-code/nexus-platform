import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import OrganizationGate from "./organization-gate";

async function AuthenticatedDashboard({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  await auth.protect();
  const query = await searchParams;
  const organizationId = typeof query.organizationId === "string"
    ? query.organizationId
    : undefined;
  return <OrganizationGate initialOrganizationId={organizationId} />;
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<div className="workspace-gate">Loading your workspace…</div>}>
      <AuthenticatedDashboard searchParams={searchParams} />
    </Suspense>
  );
}
