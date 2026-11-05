import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { OrganizationShell } from "@/components/dashboard/organization-shell";

type OrganizationLayoutProps = {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
};

async function AuthenticatedOrganizationLayout({
  children,
  params,
}: OrganizationLayoutProps) {
  await auth.protect();
  const { organizationId } = await params;
  return (
    <OrganizationShell organizationId={organizationId}>
      {children}
    </OrganizationShell>
  );
}

export default function OrganizationLayout(props: OrganizationLayoutProps) {
  return (
    <Suspense fallback={<main className="workspace-gate">Loading organization…</main>}>
      <AuthenticatedOrganizationLayout {...props} />
    </Suspense>
  );
}
