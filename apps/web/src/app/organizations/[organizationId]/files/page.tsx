import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import OrganizationFilesView from "./organization-files-view";

async function OrganizationFilesContent({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await auth.protect();
  const { organizationId } = await params;
  return <OrganizationFilesView organizationId={organizationId} />;
}

export default function OrganizationFilesPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense fallback={<main className="workspace-gate">Loading files…</main>}>
      <OrganizationFilesContent params={params} />
    </Suspense>
  );
}
