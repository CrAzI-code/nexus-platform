import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import TaskDetailsPage from "./task-details";

export const instant = false;

type TaskPageProps = {
  params: Promise<{
    organizationId: string;
    projectId: string;
    taskId: string;
  }>;
};

async function AuthenticatedTaskPage({ params }: TaskPageProps) {
  await auth.protect();
  const { organizationId, projectId, taskId } = await params;
  return (
    <TaskDetailsPage
      organizationId={organizationId}
      projectId={projectId}
      taskId={taskId}
    />
  );
}

export default function TaskPage({ params }: TaskPageProps) {
  return (
    <Suspense fallback={<main className="workspace-gate">Loading task…</main>}>
      <AuthenticatedTaskPage params={params} />
    </Suspense>
  );
}
