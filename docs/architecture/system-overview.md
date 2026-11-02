
# NEXUS System Architecture

## 1. Overview

NEXUS is a real-time team collaboration and
workflow management platform.

The application will initially use a modular
monolith architecture.

The frontend and backend will be separate
applications inside one repository.

## 2. Approved Architecture

### Frontend

Technology: Next.js, React and TypeScript.

Responsibilities:
- Render the user interface.
- Handle user interactions.
- Manage frontend state.
- Communicate with backend APIs.
- Display application data.

### Backend

Technology: NestJS and TypeScript.

Responsibilities:
- Handle API requests.
- Authenticate users.
- Enforce permissions.
- Execute business logic.
- Validate external input.
- Communicate with the database.

### Database

Technology: PostgreSQL.

Database access: Prisma ORM.

Responsibilities:
- Store application data.
- Maintain data relationships.
- Enforce database constraints.
- Support transactions.
- Preserve data integrity.

## 3. Initial Backend Modules

- Authentication
- Users
- Organizations
- Memberships
- Projects
- Tasks
- Comments
- Messaging
- Notifications
- Audit Logs

These modules will initially operate
inside one NestJS application.

## 4. Communication

The frontend communicates with the backend
through HTTP APIs using JSON. Authenticated
Server-Sent Events deliver live notifications;
WebSockets remain a future option for
bidirectional collaboration features.

The backend is responsible for enforcing
authorization and business rules.

The frontend must never connect directly
to the PostgreSQL database.

## 5. Database Architecture

PostgreSQL is the primary data store.

Prisma manages database access and
version-controlled schema migrations.

NEXUS will support multiple organizations.

Organization-owned resources must be
scoped and protected against unauthorized
cross-organization access.

## 6. Development Infrastructure

Docker will be used for local development
services, starting with PostgreSQL.

Development, testing, staging and production
environments must be separated.

## 7. Future Infrastructure

The following technologies are planned
for later engineering phases:

- Redis for caching and coordination.
- WebSockets for future bidirectional live collaboration.
- SQS or another message broker for jobs.
- S3-compatible storage for files.
- AWS for cloud deployment.
- OpenTelemetry for observability.

These technologies must only be introduced
when their functionality is required.

## 8. Architectural Principles

- Prefer simplicity over unnecessary complexity.
- Keep modules focused and maintainable.
- Keep business logic on the backend.
- Enforce authorization server-side.
- Protect organization data.
- Test important business operations.
- Document significant architectural decisions.
- Avoid premature microservices.

## 9. Current Architecture Status

Status: Modular monolith architecture implemented in the initial applications.

The NestJS API uses Prisma for PostgreSQL access and Clerk for independently
verified authentication. Organization onboarding is implemented as an
authenticated API module. The Next.js app provides the authenticated
organization setup flow and directs members to the workspace dashboard.

Organization and membership creation uses the existing database schema and
one Prisma transaction. No schema migration was required for onboarding.

Project management uses authenticated organization-scoped endpoints. Project
creation and creator membership are atomic, and project visibility is derived
from active organization and project memberships. Project archival preserves
records in the database.

Task management uses authenticated organization- and project-scoped endpoints.
Task creation, comments, and task activity entries are written transactionally.
Task comments and activity history reference both the parent task and the
project member who authored the entry, preserving tenant and project integrity.
Tasks are archived and restored without hard deletion.

Organization team management uses authenticated, organization-scoped endpoints.
Owners and Admins can issue and revoke invitations, change non-owner member roles,
and remove members. Invitation tokens are random, stored only as SHA-256 hashes,
and returned once to the authorized inviter so they can share the invitation
link. Acceptance requires a matching authenticated NEXUS email and updates the
invitation and membership atomically. Optional Brevo transactional email sends
invitation links after the invitation transaction commits.

Persisted in-app notifications are stored in PostgreSQL in the same database
transaction as task, project, invitation, or team events. Their stable event
keys and a recipient-scoped unique constraint prevent duplicate insertion.
The API publishes a stream event only after the transaction commits and
revalidates organization/project access when listing notifications. The
Next.js dashboard provides a paginated notification panel with unread counts,
read/delete actions, relative timestamps, and safe resource navigation.

The authenticated `GET /notifications/stream` endpoint streams `notification`
events containing the persisted notification JSON and `heartbeat` events
containing a timestamp. The recipient is derived only from the verified Clerk
session. The frontend sends its bearer token in the `Authorization` header,
reconnects with bounded exponential backoff, and refreshes persisted history
and unread counts after reconnecting to recover missed events. The frontend
uses the existing notification APIs if streaming is unavailable.

Live delivery currently uses an in-process subscriber registry. Events are
available only to connections attached to the same API instance; persisted
notification history remains available across instances. Multi-instance live
delivery requires shared pub/sub or a message broker, with every instance
subscribed to committed notification events and routing them to local
recipients. No Redis, broker, or external notification infrastructure is
currently required.
