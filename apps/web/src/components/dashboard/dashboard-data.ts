export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type Workspace = {
  id: string;
  name: string;
  plan: string;
  initials: string;
};

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  progress: number;
  taskCount: number;
  owner: string;
  ownerInitials: string;
  color: string;
  softColor: string;
  team: { initials: string; color: string }[];
};

export type Task = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
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

const sampleToday = "2026-10-30";

function dateOffset(days: number): string {
  const date = new Date(`${sampleToday}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const workspaces: Workspace[] = [
  { id: "nexus", name: "Nexus Studio", plan: "Pro workspace", initials: "NS" },
  { id: "orbit", name: "Orbit Labs", plan: "Team workspace", initials: "OL" },
];

export const projects: Project[] = [
  {
    id: "brand-refresh",
    workspaceId: "nexus",
    name: "Brand refresh",
    description: "Marketing · Q4 campaign",
    progress: 72,
    taskCount: 18,
    owner: "Maya Chen",
    ownerInitials: "MC",
    color: "#5b67df",
    softColor: "#eef0ff",
    team: [
      { initials: "MC", color: "#c27b68" },
      { initials: "JW", color: "#758cba" },
      { initials: "AK", color: "#66a28a" },
      { initials: "RL", color: "#ab82a1" },
    ],
  },
  {
    id: "mobile-app",
    workspaceId: "nexus",
    name: "Mobile app redesign",
    description: "Product · iOS & Android",
    progress: 48,
    taskCount: 26,
    owner: "Jordan Wells",
    ownerInitials: "JW",
    color: "#228b80",
    softColor: "#e8f6f2",
    team: [
      { initials: "JW", color: "#758cba" },
      { initials: "MC", color: "#c27b68" },
      { initials: "ST", color: "#ce9c57" },
      { initials: "AK", color: "#66a28a" },
    ],
  },
  {
    id: "website-launch",
    workspaceId: "nexus",
    name: "Website launch",
    description: "Growth · Marketing site",
    progress: 89,
    taskCount: 14,
    owner: "Avery Kim",
    ownerInitials: "AK",
    color: "#d18b3b",
    softColor: "#fff3e3",
    team: [
      { initials: "AK", color: "#66a28a" },
      { initials: "RL", color: "#ab82a1" },
      { initials: "JW", color: "#758cba" },
    ],
  },
  {
    id: "onboarding",
    workspaceId: "orbit",
    name: "Customer onboarding",
    description: "Product · Activation",
    progress: 61,
    taskCount: 21,
    owner: "Maya Chen",
    ownerInitials: "MC",
    color: "#5b67df",
    softColor: "#eef0ff",
    team: [
      { initials: "MC", color: "#c27b68" },
      { initials: "ST", color: "#ce9c57" },
      { initials: "RL", color: "#ab82a1" },
    ],
  },
  {
    id: "research",
    workspaceId: "orbit",
    name: "Customer research",
    description: "Research · Q4 insights",
    progress: 35,
    taskCount: 12,
    owner: "Avery Kim",
    ownerInitials: "AK",
    color: "#228b80",
    softColor: "#e8f6f2",
    team: [
      { initials: "AK", color: "#66a28a" },
      { initials: "JW", color: "#758cba" },
      { initials: "MC", color: "#c27b68" },
    ],
  },
];

export const initialTasks: Task[] = [
  {
    id: "task-1",
    workspaceId: "nexus",
    projectId: "brand-refresh",
    title: "Finalize homepage messaging",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: dateOffset(0),
  },
  {
    id: "task-2",
    workspaceId: "nexus",
    projectId: "mobile-app",
    title: "Review onboarding flow",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: dateOffset(1),
  },
  {
    id: "task-3",
    workspaceId: "nexus",
    projectId: "website-launch",
    title: "Prepare launch checklist",
    status: "BLOCKED",
    priority: "URGENT",
    dueDate: dateOffset(-2),
  },
  {
    id: "task-4",
    workspaceId: "nexus",
    projectId: "brand-refresh",
    title: "Share campaign concepts",
    status: "DONE",
    priority: "LOW",
    dueDate: dateOffset(-1),
  },
  {
    id: "task-5",
    workspaceId: "nexus",
    projectId: "mobile-app",
    title: "Update empty state designs",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    dueDate: dateOffset(3),
  },
  {
    id: "task-6",
    workspaceId: "nexus",
    projectId: "website-launch",
    title: "Check responsive layouts",
    status: "TODO",
    priority: "HIGH",
    dueDate: dateOffset(5),
  },
  {
    id: "task-7",
    workspaceId: "orbit",
    projectId: "onboarding",
    title: "Map first-week email journey",
    status: "IN_PROGRESS",
    priority: "HIGH",
    dueDate: dateOffset(0),
  },
  {
    id: "task-8",
    workspaceId: "orbit",
    projectId: "research",
    title: "Synthesize interview notes",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: dateOffset(2),
  },
  {
    id: "task-9",
    workspaceId: "orbit",
    projectId: "onboarding",
    title: "Share activation findings",
    status: "DONE",
    priority: "LOW",
    dueDate: dateOffset(-3),
  },
];

export const initialActivity: Activity[] = [
  {
    id: "activity-1",
    workspaceId: "nexus",
    initials: "MC",
    person: "Maya Chen",
    action: "completed",
    target: "Visual direction review",
    project: "Brand refresh",
    time: "12 minutes ago",
    color: "#c27b68",
  },
  {
    id: "activity-2",
    workspaceId: "nexus",
    initials: "JW",
    person: "Jordan Wells",
    action: "commented on",
    target: "Onboarding flow",
    project: "Mobile app redesign",
    time: "48 minutes ago",
    color: "#758cba",
  },
  {
    id: "activity-3",
    workspaceId: "nexus",
    initials: "AK",
    person: "Avery Kim",
    action: "uploaded a file to",
    target: "Launch assets",
    project: "Website launch",
    time: "2 hours ago",
    color: "#66a28a",
  },
  {
    id: "activity-4",
    workspaceId: "nexus",
    initials: "RL",
    person: "Riley Lee",
    action: "created a task in",
    target: "Homepage messaging",
    project: "Brand refresh",
    time: "Yesterday",
    color: "#ab82a1",
  },
  {
    id: "activity-5",
    workspaceId: "orbit",
    initials: "MC",
    person: "Maya Chen",
    action: "shared notes in",
    target: "Activation interviews",
    project: "Customer research",
    time: "20 minutes ago",
    color: "#c27b68",
  },
  {
    id: "activity-6",
    workspaceId: "orbit",
    initials: "ST",
    person: "Sam Taylor",
    action: "updated",
    target: "Welcome email sequence",
    project: "Customer onboarding",
    time: "1 hour ago",
    color: "#ce9c57",
  },
];

export function formatDueDate(value: string): string {
  const tomorrow = new Date(`${sampleToday}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowValue = tomorrow.toISOString().slice(0, 10);

  if (value === sampleToday) return "Today";
  if (value === tomorrowValue) return "Tomorrow";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function isOverdue(task: Task): boolean {
  if (task.status === "DONE" || !task.dueDate) return false;
  return task.dueDate < sampleToday;
}
