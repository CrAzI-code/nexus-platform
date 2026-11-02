CREATE TYPE "NotificationType" AS ENUM (
    'TASK_ASSIGNED',
    'TASK_COMMENT',
    'TASK_MENTION',
    'TASK_STATUS_CHANGED',
    'PROJECT_ADDED',
    'PROJECT_UPDATED',
    'ORGANIZATION_INVITATION',
    'TEAM_UPDATED'
);

CREATE TYPE "NotificationResourceType" AS ENUM (
    'TASK',
    'PROJECT',
    'ORGANIZATION_INVITATION',
    'ORGANIZATION'
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "resource_type" "NotificationResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "event_key" VARCHAR(160) NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_recipient_id_event_key_key"
ON "notifications"("recipient_id", "event_key");

CREATE INDEX "notifications_recipient_id_created_at_id_idx"
ON "notifications"("recipient_id", "created_at", "id");

CREATE INDEX "notifications_recipient_id_read_at_created_at_idx"
ON "notifications"("recipient_id", "read_at", "created_at");

CREATE INDEX "notifications_organization_id_recipient_id_idx"
ON "notifications"("organization_id", "recipient_id");

CREATE INDEX "notifications_project_id_idx"
ON "notifications"("project_id");

ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_recipient_id_fkey"
FOREIGN KEY ("recipient_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_organization_id_fkey"
FOREIGN KEY ("organization_id")
REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_organization_id_project_id_fkey"
FOREIGN KEY ("organization_id", "project_id")
REFERENCES "projects"("organization_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
