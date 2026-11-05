ALTER TYPE "TaskActivityType" ADD VALUE 'BLOCKER_CREATED';
ALTER TYPE "TaskActivityType" ADD VALUE 'BLOCKER_RESOLVED';

ALTER TYPE "NotificationType" ADD VALUE 'TASK_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_UNBLOCKED';
ALTER TYPE "AuditLogAction" ADD VALUE 'TASK_BLOCKED';
ALTER TYPE "AuditLogAction" ADD VALUE 'TASK_UNBLOCKED';

CREATE TABLE "task_blockers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "prior_status" "TaskStatus" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "task_blockers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_blockers_one_active_per_task"
ON "task_blockers"("organization_id", "project_id", "task_id")
WHERE "resolved_at" IS NULL;

CREATE INDEX "task_blockers_organization_id_project_id_task_id_created_at_idx"
ON "task_blockers"("organization_id", "project_id", "task_id", "created_at");

CREATE INDEX "task_blockers_organization_id_project_id_task_id_resolved_at_idx"
ON "task_blockers"("organization_id", "project_id", "task_id", "resolved_at");

ALTER TABLE "task_blockers"
ADD CONSTRAINT "task_blockers_organization_id_project_id_task_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "task_id")
REFERENCES "tasks"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_blockers"
ADD CONSTRAINT "task_blockers_created_by_id_fkey"
FOREIGN KEY ("created_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_blockers"
ADD CONSTRAINT "task_blockers_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
