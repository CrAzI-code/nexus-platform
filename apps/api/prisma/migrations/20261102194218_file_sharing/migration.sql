-- File metadata, tenant-safe task associations, and audit actions.
ALTER TYPE "AuditLogAction" ADD VALUE 'FILE_UPLOADED';
ALTER TYPE "AuditLogAction" ADD VALUE 'FILE_REMOVED';
ALTER TYPE "AuditLogTargetType" ADD VALUE 'FILE_ATTACHMENT';

CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "storage_key" VARCHAR(36) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "file_attachments_size_bytes_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "file_attachments_storage_key_key" UNIQUE ("storage_key"),
    CONSTRAINT "file_attachments_organization_id_project_id_id_key"
        UNIQUE ("organization_id", "project_id", "id")
);

CREATE INDEX "file_attachments_organization_id_project_id_removed_at_created_at_idx"
ON "file_attachments"("organization_id", "project_id", "removed_at", "created_at" DESC);

ALTER TABLE "file_attachments"
ADD CONSTRAINT "file_attachments_organization_id_project_id_fkey"
FOREIGN KEY ("organization_id", "project_id")
REFERENCES "projects"("organization_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "file_attachments"
ADD CONSTRAINT "file_attachments_organization_id_uploaded_by_id_fkey"
FOREIGN KEY ("organization_id", "uploaded_by_id")
REFERENCES "organization_memberships"("organization_id", "user_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "task_file_attachments" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,

    CONSTRAINT "task_file_attachments_pkey"
        PRIMARY KEY ("organization_id", "project_id", "file_id")
);

CREATE INDEX "task_file_attachments_organization_id_project_id_task_id_idx"
ON "task_file_attachments"("organization_id", "project_id", "task_id");

ALTER TABLE "task_file_attachments"
ADD CONSTRAINT "task_file_attachments_organization_id_project_id_task_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "task_id")
REFERENCES "tasks"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_file_attachments"
ADD CONSTRAINT "task_file_attachments_organization_id_project_id_file_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "file_id")
REFERENCES "file_attachments"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
