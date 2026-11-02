
# ADR-001: Authentication Provider

## Status
Accepted.

## Context

NEXUS requires secure user authentication
and session management.

The application uses:
- Next.js frontend
- NestJS backend
- PostgreSQL database

Authentication must work across the
frontend and separate backend API.

The project initially has a zero-budget
constraint.

## Options Considered

### Option 1: Clerk

Managed authentication service.

Advantages:
- Prebuilt authentication functionality.
- Password and session management.
- Email verification and recovery.
- Backend session token verification.
- Free initial plan.

Disadvantages:
- External service dependency.
- Free plan limitations.
- Provider migration requires planning.

### Option 2: Better Auth

Open-source authentication framework.

Advantages:
- Self-hosted.
- PostgreSQL support.
- No mandatory authentication subscription.
- Greater control over authentication data.

Disadvantages:
- More integration responsibility.
- Additional implementation complexity
  with our separate NestJS backend.

## Proposed Decision

Use Clerk for authentication in NEXUS v1,
subject to confirming plan limits and
production requirements before public launch.

Clerk will manage:
- Identity.
- Passwords.
- Registration.
- Login.
- Session management.
- Email verification.
- Password recovery.

NEXUS will manage:
- Internal user profiles.
- Organizations.
- Memberships.
- Organization roles.
- Project permissions.
- Application data.

## Backend Security

The NestJS backend must independently
verify every incoming authentication token.

It must not trust user IDs supplied by
the frontend.

After authentication, the backend must
resolve the internal NEXUS user and perform
organization and resource authorization.

## Database Implications

The users table will contain:
- Internal UUID.
- Authentication provider.
- External authentication subject.
- Name.
- Email.
- Created timestamp.
- Updated timestamp.

NEXUS will not store Clerk-managed passwords.

## Provider Independence

Business logic must not depend directly
on Clerk-specific user IDs.

Use an internal NEXUS user identifier
for application relationships.

## Cost Policy

Use the free plan during initial development.

Review pricing and limitations before
public production launch.

Do not enable paid services without
explicit approval.

## Consequences

This reduces custom authentication
implementation while preserving
NEXUS-owned authorization and
organization management.

Provider migration may require an account
mapping and identity verification process.

## Implementation Status

The first frontend authentication milestone is implemented:
- Clerk is configured in the Next.js app with accountless development credentials.
- The dashboard requires an authenticated Clerk session.
- Sign-in and sign-up routes are available, with a signed-in user menu.
- Clerk Organizations are not enabled.

The NestJS API independently verifies Clerk session JWTs, restricts authorized
parties, provisions NEXUS user identities transactionally, and protects
`GET /auth/me`. NEXUS remains responsible for authorization and organization
data. Organization and project authorization are not implemented yet.
