import type { TaskPriority, TaskStatus } from "@/lib/tasks";

export type { TaskPriority, TaskStatus } from "@/lib/tasks";

export type Workspace = {
  id: string;
  name: string;
  plan: string;
  initials: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
};

export type TaskProject = { id: string; name: string };

export type Task = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  archivedAt: string | null;
};

export type Activity = {
  id: string;
  workspaceId: string;
  initials: string;
  person: string;
  action: string;
  target: string;
  project: string;
  time: string;
  color: string;
};

export const initialActivity: Activity[] = [];

export function formatDueDate(value: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowValue = tomorrow.toISOString().slice(0, 10);

  if (value === today) return "Today";
  if (value === tomorrowValue) return "Tomorrow";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function isOverdue(task: Task): boolean {
  if (task.status === "DONE" || !task.dueDate || task.archivedAt) return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}
