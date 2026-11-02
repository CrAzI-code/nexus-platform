import { Suspense } from "react";
import TeamManagement from "./team-management";

async function OrganizationMembersContent({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <TeamManagement organizationId={organizationId} />;
}

export default function OrganizationMembersPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="team-page-shell" aria-live="polite">
          <p>Loading your organization team…</p>
        </main>
      }
    >
      <OrganizationMembersContent params={params} />
    </Suspense>
  );
}
