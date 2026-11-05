ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_DISCUSSION_MESSAGE';

CREATE TABLE "project_discussions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_discussions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_discussion_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "discussion_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_discussion_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_discussion_reads" (
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "discussion_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(3),
    "last_read_message_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_discussion_reads_pkey"
        PRIMARY KEY ("organization_id", "project_id", "discussion_id", "user_id")
);

CREATE UNIQUE INDEX "project_discussions_organization_id_project_id_id_key"
ON "project_discussions"("organization_id", "project_id", "id");

CREATE INDEX "project_discussions_organization_id_project_id_created_at_id_idx"
ON "project_discussions"("organization_id", "project_id", "created_at", "id");

CREATE INDEX "project_discussion_messages_cursor_idx"
ON "project_discussion_messages"("organization_id", "project_id", "discussion_id", "created_at", "id");

CREATE UNIQUE INDEX "project_discussion_messages_scope_id_key"
ON "project_discussion_messages"("organization_id", "project_id", "discussion_id", "id");

CREATE INDEX "project_discussion_reads_organization_id_project_id_user_id_idx"
ON "project_discussion_reads"("organization_id", "project_id", "user_id");

ALTER TABLE "project_discussions"
ADD CONSTRAINT "project_discussions_organization_id_project_id_fkey"
FOREIGN KEY ("organization_id", "project_id")
REFERENCES "projects"("organization_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_discussions"
ADD CONSTRAINT "project_discussions_created_by_id_fkey"
FOREIGN KEY ("created_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_discussion_messages"
ADD CONSTRAINT "project_discussion_messages_organization_id_project_id_discussion_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "discussion_id")
REFERENCES "project_discussions"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_discussion_messages"
ADD CONSTRAINT "project_discussion_messages_author_id_fkey"
FOREIGN KEY ("author_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_discussion_reads"
ADD CONSTRAINT "project_discussion_reads_organization_id_project_id_discussion_id_fkey"
FOREIGN KEY ("organization_id", "project_id", "discussion_id")
REFERENCES "project_discussions"("organization_id", "project_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_discussion_reads"
ADD CONSTRAINT "project_discussion_reads_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
