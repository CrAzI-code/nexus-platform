import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import ProjectDetails from "./project-details";

type ProjectPageProps = {
  params: Promise<{ organizationId: string; projectId: string }>;
};

async function AuthenticatedProjectPage({ params }: ProjectPageProps) {
  await auth.protect();
  const { organizationId, projectId } = await params;
  return (
    <ProjectDetails
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}

export default function ProjectPage({ params }: ProjectPageProps) {
  return (
    <Suspense fallback={<main className="workspace-gate">Loading project…</main>}>
      <AuthenticatedProjectPage params={params} />
    </Suspense>
  );
}
