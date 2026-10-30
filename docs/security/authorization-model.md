
# NEXUS Authentication and Authorization

## 1. Purpose

Define how NEXUS identifies users and
controls access to organizations and resources.

## 2. Authentication

Authentication answers:

Who is the currently logged-in user?

Requirements:
- Users must authenticate before accessing protected resources.
- Passwords must never be stored in plaintext.
- Sessions must expire securely.
- Logout must invalidate the session.
- Password recovery must use secure, expiring tokens.
- Sensitive authentication operations must be rate-limited.


The authentication provider for NEXUS v1
has been selected as Clerk.

This decision is documented in
ADR-001-authentication-provider.md.

Clerk is responsible for authentication
and session management.

NEXUS is responsible for:
- Internal user identity mapping.
- Organization memberships.
- Organization roles.
- Project access.
- Resource-level authorization.

The NestJS backend must independently
verify authentication tokens and enforce
all authorization rules.

## 3. Authorization

Authorization answers:

What is this user allowed to do?

All authorization decisions must happen
on the backend.

Frontend checks are for user experience only.


## 4. Organization Ownership

Each active organization must have exactly
one Owner in NEXUS v1.

Rules:
- The organization creator becomes its first Owner.
- An organization must always have one active Owner.
- Only the Owner can transfer ownership.
- Ownership transfer must use a database transaction.
- An Owner cannot leave or be removed before
  transferring ownership.
- Organization deletion is not a normal operation.
- Archiving must be supported before considering
  permanent deletion.

## 5. Organization Roles

### OWNER
- Full organization control.
- Manage organization settings.
- Invite and manage members.
- Assign organization roles.
- Transfer ownership.
- Access all organization projects.
- Manage all organization projects.

### ADMIN
- Manage organization members.
- Send and manage invitations.
- Assign roles except OWNER.
- Access all organization projects.
- Manage all organization projects.
- Cannot transfer ownership.
- Cannot archive or permanently delete the organization.

### MANAGER
- Create projects.
- Access projects they belong to.
- Manage tasks within assigned projects.
- Manage project membership within assigned projects,
  subject to organization membership rules.

When a Manager creates a project,
they automatically become a project member.

### MEMBER
- Access projects they belong to.
- Work on assigned tasks.
- Participate in permitted project discussions.
- Cannot manage organization membership.
- Cannot create projects.

## 6. Project Membership Rules

Project membership determines which projects
Managers and Members can access.

Rules:
- A project belongs to one organization.
- A project member must be an active
  member of that organization.
- A project membership does not grant
  organization membership.
- Owners and Admins have access to all
  projects within their organization.
- Managers and Members require active
  project membership.
- Project creation by a Manager automatically
  adds the creator as a project member.
- Only authorized users can add or remove
  project members.

Project-level roles are not introduced
in NEXUS v1.

Organization roles determine permissions.
Project membership determines project access.

## 7. Organization Membership Removal

When a user's organization membership
is suspended or removed:

- Their organization access is revoked.
- Their project access is immediately revoked.
- They cannot be assigned new tasks.
- Existing project history and audit records
  must be preserved.
- Access must not be restored automatically
  if the user is invited again.

Every protected request must verify
active organization membership.

## 8. Multi-Tenant Isolation

Every organization-owned resource must
belong to the correct organization.

This applies to:
- Projects.
- Tasks.
- Comments.
- Messages.
- Attachments.
- Notifications.

Backend queries must be scoped to
the authorized organization.

The backend must never trust organization
IDs or project IDs supplied by the client
without authorization checks.

Database constraints must protect
important ownership relationships.

Cross-organization access must be denied.

## 9. Authorization Enforcement

All authorization checks must happen
on the backend.

The backend must:

1. Verify user authentication.
2. Resolve the internal NEXUS user.
3. Verify active organization membership.
4. Check organization role.
5. Verify project membership when required.
6. Verify resource ownership and permissions.
7. Execute the requested operation only
   when authorization succeeds.

Authorization logic must be reusable
and consistently applied across modules.

## 10. Organization Lifecycle

Ownership transfer must be atomic.

The old Owner must not lose ownership
unless the new Owner successfully
receives it.

An organization must not end up
without an Owner.

Organization archiving must prevent
normal member operations.

Permanent deletion requires a separate
approved data-retention and deletion policy.

## 11. Authorization Testing

Required tests:

- Unauthenticated users cannot access protected endpoints.
- Non-members cannot access an organization.
- Managers cannot access unassigned projects.
- Members cannot access unassigned projects.
- Owners and Admins can access organization projects.
- Non-Owners cannot transfer ownership.
- An organization always retains an Owner.
- Project members must belong to the organization.
- Removed members immediately lose project access.
- Cross-organization data access is rejected.
- Task assignments cannot target unauthorized users.

## 12. Current Status

Status: Proposed v1 authorization policy.

Authentication provider: Clerk (approved).

Implementation: Not started.

Database constraints and authorization
tests must be designed before implementation.


### OWNER
- Full organization control.
- Manage members and permissions.
- Manage all projects.
- Control organization ownership and deletion.

### ADMIN
- Manage organization members.
- Manage invitations.
- Manage organization projects.
- Cannot transfer ownership or delete the organization.

### MANAGER
- Create projects.
- Manage projects they are assigned to.
- Manage tasks within permitted projects.

### MEMBER
- Access projects they belong to.
- Work on assigned tasks.
- Comment and participate in permitted discussions.

## 5. Access Control Rules

- Every user must have a valid authenticated identity.
- Users must belong to an organization before accessing its resources.
- Organization-owned resources must be scoped to the correct organization.
- Managers and members must have appropriate project access.
- The backend must verify permissions on every protected operation.
- Never trust organization IDs or user IDs supplied by the client without verification.

## 6. Multi-Tenant Isolation

Organization A must never access
Organization B's private resources.

This applies to:
- Projects.
- Tasks.
- Comments.
- Messages.
- Attachments.
- Notifications.

Cross-organization access attempts must be rejected.

## 7. Authorization Testing

Required tests include:

- Unauthenticated users cannot access protected endpoints.
- Members cannot perform owner-only actions.
- Managers cannot manage organization ownership.
- Users cannot access projects outside their permitted scope.
- Users cannot access another organization's tasks.
- Users cannot read another user's private notifications.

## 8. Current Status

Status: Permission model proposed.

Authentication provider: Not selected.

Implementation: Not started.

All decisions must be reviewed before implementation.
