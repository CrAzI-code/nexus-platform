-- Add a composite task key so comments and activity records remain project-scoped.
CREATE UNIQUE INDEX "tasks_organization_id_project_id_id_key"
ON "tasks"("organization_id", "project_id", "id");

CREATE TYPE "TaskActivityType" AS ENUM (
    'CREATED',
    'UPDATED',
    'STATUS_CHANGED',
    'ASSIGNEE_CHANGED',
    'COMMENT_ADDED',
    'ARCHIVED',
    'RESTORED'
);

CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" "TaskActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_comments_organization_id_project_id_task_id_created_at_idx"
ON "task_comments"("organization_id", "project_id", "task_id", "created_at");

CREATE INDEX "task_activities_organization_id_project_id_task_id_created__idx"
ON "task_activities"("organization_id", "project_id", "task_id", "created_at");

ALTER TABLE "task_comments"
ADD CONSTRAINT "task_comments_organization_id_project_id_task_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "task_id")
REFERENCES "tasks"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_comments"
ADD CONSTRAINT "task_comments_organization_id_project_id_author_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "author_id")
REFERENCES "project_members"("organization_id", "project_id", "user_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_activities"
ADD CONSTRAINT "task_activities_organization_id_project_id_task_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "task_id")
REFERENCES "tasks"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_activities"
ADD CONSTRAINT "task_activities_organization_id_project_id_actor_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "actor_id")
REFERENCES "project_members"("organization_id", "project_id", "user_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
