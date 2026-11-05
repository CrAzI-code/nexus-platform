import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import OrganizationSettingsView from "./organization-settings-view";

async function OrganizationSettingsContent({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await auth.protect();
  const { organizationId } = await params;
  return (
    <OrganizationSettingsView
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

export default function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense
      fallback={<main className="workspace-gate">Loading settings…</main>}
    >
      <OrganizationSettingsContent params={params} />
    </Suspense>
  );
}
