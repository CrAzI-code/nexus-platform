import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import AuditLogView from "./audit-log-view";

async function OrganizationAuditLogsContent({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await auth.protect();
  const { organizationId } = await params;
  return <AuditLogView organizationId={organizationId} />;
}

export default function OrganizationAuditLogsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense
      fallback={<main className="workspace-gate">Loading audit logs…</main>}
    >
      <OrganizationAuditLogsContent params={params} />
    </Suspense>
  );
}
