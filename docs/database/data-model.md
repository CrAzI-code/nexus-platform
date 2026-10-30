
# NEXUS Database Design

## 1. Database Technology

Primary database: PostgreSQL.

Database access: Prisma ORM.

The database uses a relational data model.

## 2. Multi-Tenant Architecture

NEXUS supports multiple organizations.

Users may belong to multiple organizations.

Organizations must never read or modify
another organization's private data.

Organization-owned resources must have
enforced ownership and tenant relationships.

All tenant authorization checks must be enforced
by the backend, not only by the frontend.

## 3. Design Principles

- Use internal UUIDs as the stable NEXUS user identity.
- Keep external authentication provider data separate from app users.
- Use explicit organization memberships to control access.
- Keep project membership separate from project roles in v1.
- Retain historical membership records instead of deleting them immediately.
- Use archive-first behavior for active business records.
- Use transaction-safe backend logic for complex ownership rules.
- Keep schema changes explicit and reviewed when new statuses or values are introduced.

## 4. Proposed Database Tables

### Users

Stores NEXUS internal user profiles.

Authentication is managed externally by Clerk.

Proposed fields:
- id (UUID, Primary Key)
- name
- email
- status
- created_at
- updated_at

Allowed values for status:
- ACTIVE
- SUSPENDED
- DISABLED

Additional values require reviewed schema migrations.

Constraints:
- Internal UUID is used for all NEXUS business relationships.
- Email is not used as the permanent identity key.
- Passwords are not stored in NEXUS.
- Provider-specific identity fields do not live in users.
- Permanent account deletion and data-erasure policy remain future decisions.

### Auth Identities

Stores mappings between NEXUS users and external authentication providers.

Proposed fields:
- id (UUID, Primary Key)
- user_id (Foreign Key → users.id)
- provider
- provider_subject
- created_at

Constraints:
- UNIQUE(provider, provider_subject)
- UNIQUE(user_id, provider)
- One identity per provider per NEXUS user in v1.
- Account linking is not implemented in v1.
- A NEXUS user may have multiple external identities in the future, but v1 uses one per provider.

### Organizations

Stores companies and teams.

Proposed fields:
- id (UUID, Primary Key)
- name
- slug
- status
- created_at
- updated_at

Allowed values for status:
- ACTIVE
- ARCHIVED

Constraints:
- Organization slug is unique.
- Additional values require reviewed schema migrations.

### Organization Memberships

Connects users to organizations.

Table name:
- organization_memberships

Proposed fields:
- id (UUID, Primary Key)
- user_id (Foreign Key → users.id)
- organization_id (Foreign Key → organizations.id)
- role
- status
- created_at
- updated_at

Allowed roles:
- OWNER
- ADMIN
- MANAGER
- MEMBER

Allowed statuses:
- ACTIVE
- SUSPENDED
- REMOVED

Additional values require reviewed schema migrations.

Constraints:
- UNIQUE(organization_id, user_id)
- user_id must reference an existing user.
- organization_id must reference an existing organization.
- removed records are retained and may be reactivated.
- a user can rejoin without creating a duplicate active membership record.

Ownership rules:
- Exactly one ACTIVE OWNER must exist per ACTIVE organization.
- The database enforces at most one active owner by using a partial unique index.
- NestJS transactions and organization-row locking enforce the minimum-one-owner rule.
- Ownership transfer must be atomic.
- The current owner must never be suspended or removed unless a replacement owner is established in the same transaction, or the organization is transitioned to inactive atomically.

### Invitations

Stores invitations to join organizations.

Proposed fields:
- id (UUID, Primary Key)
- organization_id (Foreign Key → organizations.id)
- inviter_id (Foreign Key → users.id)
- email
- intended_role
- status
- token_hash
- expires_at
- accepted_at
- created_at
- updated_at

Allowed statuses:
- PENDING
- ACCEPTED
- EXPIRED
- REVOKED

Constraints:
- token_hash is unique.
- organization_id must reference an existing organization.
- inviter_id must reference an existing user if present.
- OWNER cannot be granted through a normal invite.
- Additional status values require reviewed schema migrations.

### Projects

Stores organization projects.

Proposed fields:
- id (UUID, Primary Key)
- organization_id (Foreign Key → organizations.id)
- name
- description
- status
- created_at
- updated_at

Allowed values for status:
- ACTIVE
- ARCHIVED

Constraints:
- Every project belongs to exactly one organization.
- UNIQUE(organization_id, id)
- Project names do not require unique enforcement unless a business requirement exists.
- Archive rather than routine hard deletion.
- Additional values require reviewed schema migrations.

### Project Members

Connects users to projects.

Table name:
- project_members

Proposed fields:
- id (UUID, Primary Key)
- organization_id
- project_id
- user_id
- status
- created_at
- updated_at

Allowed statuses:
- ACTIVE
- REMOVED

Additional values require reviewed schema migrations.

Constraints:
- UNIQUE(organization_id, project_id, user_id)
- organization_id must reference an existing organization.
- project_id must reference an existing project.
- user_id must reference an existing user.
- Project membership requires an existing organization membership.
- Project membership is not a separate role system in v1.
- A user must have organization membership before they may be attached to a project.
- Re-added users reactivate the existing record rather than creating a duplicate active row.

Important:
- No project-level roles are introduced in v1.
- Project members do not receive a separate project role.
- Organization Owners and Admins can access all projects in their organization.
- Managers and Members require active project membership.

### Tasks

Stores work items within projects.

Proposed fields:
- id (UUID, Primary Key)
- organization_id (Foreign Key → organizations.id)
- project_id (Foreign Key → projects.id)
- title
- description
- status
- priority
- assignee_id (nullable, Foreign Key → users.id)
- due_at
- created_at
- updated_at

Allowed values for status:
- TODO
- IN_PROGRESS
- BLOCKED
- DONE

Allowed values for priority:
- LOW
- MEDIUM
- HIGH
- URGENT

Constraints:
- assignee_id is nullable.
- Every task must belong to a valid project.
- Every task must belong to the same organization as its parent project.
- An assigned user must have active project membership.
- New assignments require active membership.
- Assignment history is preserved in audit_logs when membership is removed.
- Completed task attribution remains intact.
- Additional values require reviewed schema migrations.

### Comments
Stores discussions associated with tasks.

### Channels
Stores team communication channels.

### Messages
Stores messages sent through channels.

### Notifications
Stores notifications belonging to users.

### Attachments
Stores metadata and references for uploaded files.

### Audit Logs
Stores important application activity.

## 5. Relationship Rules

- A user can belong to multiple organizations.
- An organization can have multiple users.
- An organization can contain multiple projects.
- A project can contain multiple tasks.
- A task can have multiple comments.
- A project can have multiple members.
- A channel can contain multiple messages.
- A user can have multiple notifications.
- Removed members retain historical access context and can be reactivated.

## 6. Composite Foreign Keys and Tenant Integrity

Tenant integrity is enforced by the database and by application logic.

Required composite foreign keys:

- project_members(organization_id, project_id)
  REFERENCES projects(organization_id, id)
- project_members(organization_id, user_id)
  REFERENCES organization_memberships(organization_id, user_id)
- tasks(organization_id, project_id)
  REFERENCES projects(organization_id, id)
- tasks(organization_id, project_id, assignee_id)
  REFERENCES project_members(organization_id, project_id, user_id)

Required uniqueness for composite references:
- projects: UNIQUE(organization_id, id)
- organization_memberships: UNIQUE(organization_id, user_id)
- project_members: UNIQUE(organization_id, project_id, user_id)

These foreign keys enforce relationship existence and same-organization membership.
They do not enforce ACTIVE status.

What PostgreSQL enforces directly:
- parent-child existence
- same-organization integrity
- value and uniqueness constraints
- basic referential integrity

What NestJS must validate in transaction-safe operations:
- membership is ACTIVE before granting access
- task assignment requires active project membership
- owner transfer preserves at least one active owner
- organization membership is required before project membership is created
- user removal disables access and triggers unassignment or reassignment logic
- assignment and ownership transitions occur atomically

## 7. Ownership, Membership and Project Access

Organization ownership is a special rule.

- Exactly one ACTIVE OWNER is allowed per ACTIVE organization.
- The partial unique index enforces at most one active owner.
- The backend must enforce the minimum-one-owner rule when ownership changes or a current owner is changed.
- Ownership transfers must happen in a single transaction.
- Organization membership is required before project membership is granted.
- Project access does not create an independent project-role layer in v1.
- Historical membership records are retained for audit and reactivation.

## 8. Membership Lifecycle and Revocation

Membership and access are controlled by status, not by deletion alone.

Lifecycle rules:
- organization_memberships.status values: ACTIVE, SUSPENDED, REMOVED
- project_members.status values: ACTIVE, REMOVED
- removed records are retained for historical integrity and reactivation
- when an organization member is removed:
  - revoke access immediately
  - unassign or reassign open tasks
  - record previous assignments in audit_logs
  - preserve completed task attribution
  - prevent new assignments to inactive members

Invitation lifecycle:
- invitations.status values: PENDING, ACCEPTED, EXPIRED, REVOKED
- invitation records remain historical once processed
- the accepted invite creates the relevant organization membership and account setup flow

## 9. Database Integrity Standards

The final schema must use:

- UUID primary keys.
- snake_case database naming.
- PostgreSQL timestamps with time zones.
- Foreign keys and composite foreign keys for same-organization integrity.
- Unique constraints for business identity.
- Explicit status and role check constraints where appropriate.
- Transactions for ownership changes, membership changes and task assignment changes.
- Archive-first behavior rather than routine hard deletes.
- Non-redundant indexes for tenant-scoped queries and foreign-key lookups.

Redundant indexes are not kept if they duplicate a primary-key or unique-constraint index.

## 10. Required Indexes and Constraints

The final design keeps only indexes needed for the documented access patterns and tenant-scoped queries.

Recommended indexes:
- users: email
- auth_identities: provider, provider_subject; user_id
- organizations: slug
- organization_memberships: organization_id, user_id
- projects: organization_id
- project_members: organization_id, project_id, user_id
- tasks: organization_id, project_id, assignee_id, status, due_at
- invitations: organization_id, email, expires_at
- audit_logs: organization_id, user_id, created_at

Additional constraints:
- unique slug on organizations
- unique provider + provider_subject on auth_identities
- unique user_id + provider on auth_identities
- unique organization_id + user_id on organization_memberships
- unique organization_id + project_id + user_id on project_members
- unique organization_id + id on projects
- valid role and status values by enum or CHECK constraints

## 11. Security Requirements

- Passwords must never be stored in plaintext.
- Organization access must be verified.
- Unauthorized cross-organization access must fail.
- Sensitive credentials must not be stored in source code.
- Database access must happen through the backend.
- Organization-level and project-level authorization must be enforced server-side.
- A user cannot be assigned to a task unless they are an active member of the relevant project.

## 12. Current Status

Status: Conceptual model drafted and aligned with the current architecture decisions.

No production database schema has been created.

No Prisma schema has been generated.

No SQL migration files have been generated.

The current design stays consistent with:
- Clerk authentication
- internal NEXUS user UUIDs
- separate auth_identities table
- exactly one active Owner per active organization
- no project-level roles
- organization membership required before project membership
- composite tenant foreign keys
- task assignment requires active project membership
- historical membership retention
- archive-first approach

All relationships and constraints remain subject to final implementation review before production use.
