ALTER TYPE "TaskActivityType" ADD VALUE 'AUTOMATION';
ALTER TYPE "NotificationType" ADD VALUE 'WORKFLOW_AUTOMATION';

CREATE TYPE "WorkflowAutomationTrigger" AS ENUM (
  'TASK_CREATED',
  'TASK_STATUS_CHANGED',
  'TASK_ASSIGNED',
  'TASK_DUE_DATE_APPROACHING',
  'TASK_OVERDUE',
  'TASK_BLOCKER_REPORTED',
  'TASK_BLOCKER_RESOLVED'
);

CREATE TYPE "WorkflowAutomationAction" AS ENUM (
  'SEND_NOTIFICATION',
  'CHANGE_STATUS',
  'ASSIGN_MEMBER'
);

CREATE TYPE "WorkflowAutomationExecutionStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'SKIPPED',
  'FAILED'
);

CREATE TABLE "workflow_automations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "trigger" "WorkflowAutomationTrigger" NOT NULL,
  "condition_priority" "TaskPriority",
  "condition_status" "TaskStatus",
  "condition_assignee_id" UUID,
  "action" "WorkflowAutomationAction" NOT NULL,
  "action_value" VARCHAR(500),
  "action_assignee_id" UUID,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "workflow_automations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_automations_project_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "projects"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_automations_creator_fkey"
    FOREIGN KEY ("created_by_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_automations_condition_assignee_fkey"
    FOREIGN KEY ("organization_id", "project_id", "condition_assignee_id")
    REFERENCES "project_members"("organization_id", "project_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_automations_action_assignee_fkey"
    FOREIGN KEY ("organization_id", "project_id", "action_assignee_id")
    REFERENCES "project_members"("organization_id", "project_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workflow_automations_organization_id_project_id_id_key"
  ON "workflow_automations"("organization_id", "project_id", "id");
CREATE INDEX "workflow_automations_organization_id_project_id_enabled_trigger_idx"
  ON "workflow_automations"("organization_id", "project_id", "enabled", "trigger");

CREATE TABLE "workflow_automation_executions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "source_activity_id" UUID,
  "event_key" VARCHAR(200) NOT NULL,
  "trigger" "WorkflowAutomationTrigger" NOT NULL,
  "status" "WorkflowAutomationExecutionStatus" NOT NULL DEFAULT 'RUNNING',
  "reason" VARCHAR(500),
  "error" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "triggered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),

  CONSTRAINT "workflow_automation_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_automation_executions_rule_fkey"
    FOREIGN KEY ("organization_id", "project_id", "rule_id")
    REFERENCES "workflow_automations"("organization_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_automation_executions_task_fkey"
    FOREIGN KEY ("organization_id", "project_id", "task_id")
    REFERENCES "tasks"("organization_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_automation_executions_source_activity_fkey"
    FOREIGN KEY ("source_activity_id")
    REFERENCES "task_activities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workflow_automation_executions_rule_id_event_key_key"
  ON "workflow_automation_executions"("rule_id", "event_key");
CREATE INDEX "workflow_automation_executions_organization_id_project_id_triggered_at_idx"
  ON "workflow_automation_executions"("organization_id", "project_id", "triggered_at" DESC);
CREATE INDEX "workflow_automation_executions_status_attempt_triggered_at_idx"
  ON "workflow_automation_executions"("status", "attempt", "triggered_at");
