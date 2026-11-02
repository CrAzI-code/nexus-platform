CREATE TYPE "AuditLogAction" AS ENUM (
    'ORGANIZATION_MEMBER_ROLE_CHANGED',
    'ORGANIZATION_MEMBER_REMOVED',
    'INVITATION_CREATED',
    'INVITATION_REVOKED',
    'INVITATION_ACCEPTED',
    'PROJECT_CREATED',
    'PROJECT_UPDATED',
    'PROJECT_ARCHIVED',
    'PROJECT_RESTORED',
    'PROJECT_MEMBER_ADDED',
    'PROJECT_MEMBER_REMOVED',
    'TASK_ASSIGNED',
    'TASK_UPDATED',
    'TASK_STATUS_CHANGED',
    'TASK_ARCHIVED',
    'TASK_RESTORED'
);

CREATE TYPE "AuditLogTargetType" AS ENUM (
    'ORGANIZATION_MEMBER',
    'INVITATION',
    'PROJECT',
    'PROJECT_MEMBER',
    'TASK'
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "AuditLogAction" NOT NULL,
    "target_type" "AuditLogTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_organization_id_created_at_id_idx"
ON "audit_logs"("organization_id", "created_at" DESC, "id" DESC);

CREATE INDEX "audit_logs_organization_id_action_created_at_idx"
ON "audit_logs"("organization_id", "action", "created_at" DESC);

CREATE INDEX "audit_logs_organization_id_actor_id_created_at_idx"
ON "audit_logs"("organization_id", "actor_id", "created_at" DESC);

CREATE INDEX "audit_logs_organization_id_target_type_target_id_created_at_idx"
ON "audit_logs"("organization_id", "target_type", "target_id", "created_at" DESC);

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_organization_id_fkey"
FOREIGN KEY ("organization_id")
REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_actor_id_fkey"
FOREIGN KEY ("actor_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
